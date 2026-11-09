import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createReader, fetchInventory, InventoryApiError, LOCATIONS, VARIANTS, LEVELS, pages, type Graphql } from "../app/inventory/shopify.server";

const location = (id: string) => ({ id, name: id });
const level = (id: string, quantity: number | null) =>
  ({ location: location(id), quantities: quantity === null ? [] : [{ name: "available", quantity }] });
const page = <T>(nodes: T[], endCursor: string | null = null) =>
  ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } });

test("walks independent location, variant, and level cursors and retains known zeros", async () => {
  const cursors: unknown[] = [];
  const variant = (id: string) => ({ id, title: "One", product: { id: "product", title: "Cup" }, sku: id });
  const graphql: Graphql = async (query, { variables }) => {
    cursors.push(variables.after);
    if (query === LOCATIONS) return Response.json({ data: {
      locations: variables.after ? page([location("b"), location("c")]) : page([location("a")], "loc"),
    } });
    if (query === LEVELS) {
      assert.equal(variables.id, "item");
      return Response.json({ data: { inventoryItem: { inventoryLevels: variables.after === "levels-1"
        ? page([level("b", null)], "levels-2") : page([level("c", -3), level("inactive", 1)]) } } });
    }
    assert.equal(query, VARIANTS);
    return Response.json({ data: { productVariants: variables.after
      ? page([{ ...variant("v2"), inventoryItem: null }, { ...variant("v3"), inventoryItem: {
        tracked: false, inventoryLevels: page([level("a", 10)]),
      } }])
      : page([{ ...variant("v1"), inventoryItem: {
        id: "item", tracked: true, inventoryLevels: page([level("a", 0)], "levels-1"),
      } }], "variants") } });
  };
  const result = await fetchInventory(graphql);
  assert.deepEqual(cursors, [null, "loc", null, "levels-1", "levels-2", "variants"]);
  assert.deepEqual(result.locations.map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(result.variants.map(item => item.available), [{ a: 0, b: null, c: -3 }, {}, {}]);
  assert.deepEqual(result.variants.map(item => item.tracked), [true, null, false]);
});

test("repeated and missing cursors fail instead of truncating inventory", async () => {
  for (const endCursor of ["repeated", null]) {
    await assert.rejects(async () => {
      for await (const nodes of pages(async () => ({
        nodes: [1], pageInfo: { hasNextPage: true, endCursor },
      }), "repeated")) assert.deepEqual(nodes, [1]);
    }, InventoryApiError);
  }
});

test("handles Shopify SDK throttling and honors Retry-After", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const read = createReader(async () => {
    attempts++;
    if (attempts === 1) throw { response: { code: 429, retryAfter: 3 } };
    if (attempts === 2) throw { response: new Response(null), body: {
      errors: { graphQLErrors: [{ extensions: { code: "THROTTLED" } }] },
    } };
    return Response.json({ data: { ok: true } });
  }, async ms => { delays.push(ms); });
  assert.deepEqual(await read("query", {}), { ok: true });
  assert.deepEqual(delays, [3000, 2000]);
});

test("HTTP 503 recovers, persistent 503 is bounded, and access denial fails immediately", async () => {
  for (const [status, recovery, expected] of [[503, true, 2], [503, false, 4], [403, false, 1]] as const) {
    let calls = 0;
    const read = createReader(async () => {
      calls++;
      if (recovery && calls === 2) return Response.json({ data: { ok: true } });
      throw { response: { code: status } };
    }, async () => {});
    if (recovery) await read("query", {});
    else await assert.rejects(read("query", {}), InventoryApiError);
    assert.equal(calls, expected);
  }
});

test("partial GraphQL success with a schema error is rejected without retry", async () => {
  let calls = 0;
  const read = createReader(async () => {
    calls++;
    return Response.json({ data: { partial: true }, errors: [{ extensions: { code: "ACCESS_DENIED" } }] });
  }, async () => {});
  await assert.rejects(read("query", {}), InventoryApiError);
  assert.equal(calls, 1);
});

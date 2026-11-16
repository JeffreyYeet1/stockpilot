import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCATIONS, VARIANTS } from "../app/inventory/shopify.server";
import { verifyStockChange } from "./support/refresh-scenario";

test("manual refresh recalculates risk when upstream inventory changes", async () => {
  const location = { id: "location", name: "Retail" };
  const page = <T>(...nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  let available = 0;
  let variantReads = 0;
  await verifyStockChange({
    shop: "fixture.myshopify.com", variantId: "variant", locationId: location.id,
    changeStock: async () => { available = 3; },
    graphql: async query => {
      if (query === LOCATIONS) return Response.json({ data: { locations: page(location) } });
      assert.equal(query, VARIANTS);
      variantReads++;
      return Response.json({ data: { productVariants: page({
        id: "variant", title: "Standard", sku: "STOCKPILOT-E2E",
        product: { id: "product", title: "Snowboard" },
        inventoryItem: {
          id: "item", tracked: true,
          inventoryLevels: page({ location, quantities: [{ name: "available", quantity: available }] }),
        },
      }) } });
    },
  });
  assert.equal(variantReads, 2, "only the cold read and manual refresh call Shopify");
});

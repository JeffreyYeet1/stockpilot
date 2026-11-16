import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createReader, type Graphql } from "../app/inventory/shopify.server";
import { verifyStockChange } from "../tests/support/refresh-scenario";

const fixtureQuery = `query StockPilotTestFixture($variantId: ID!, $locationId: ID!) {
  shop { myshopifyDomain plan { partnerDevelopment } }
  productVariant(id: $variantId) {
    sku
    inventoryItem {
      id tracked
      inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
    }
  }
}`;

const adjustQuery = `mutation StockPilotTestAdjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { changes { name delta } }
    userErrors { code }
  }
}`;

type Fixture = {
  shop: { myshopifyDomain: string; plan: { partnerDevelopment: boolean } };
  productVariant: {
    sku: string | null;
    inventoryItem: {
      id: string; tracked: boolean;
      inventoryLevel: { quantities: { name: string; quantity: number }[] } | null;
    };
  } | null;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. See the README's live dev-store test setup.`);
  return value;
}

async function run() {
  const shop = required("STOCKPILOT_TEST_SHOP");
  const variantId = required("STOCKPILOT_TEST_VARIANT_ID");
  const locationId = required("STOCKPILOT_TEST_LOCATION_ID");
  assert.match(shop, /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "Expected a canonical myshopify.com domain");
  assert.match(variantId, /^gid:\/\/shopify\/ProductVariant\/\d+$/);
  assert.match(locationId, /^gid:\/\/shopify\/Location\/\d+$/);

  const baseUrl = `https://${shop}`;
  const auth = await fetch(`${baseUrl}/admin/oauth/access_token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: required("STOCKPILOT_TEST_CLIENT_ID"),
      client_secret: required("STOCKPILOT_TEST_CLIENT_SECRET"),
    }),
  });
  if (!auth.ok) throw new Error(`Shopify test app authentication failed (HTTP ${auth.status})`);
  const { access_token: token } = await auth.json() as { access_token?: string };
  if (!token) throw new Error("Shopify returned no access token");

  const graphql: Graphql = (query, { variables, signal }) =>
    fetch(`${baseUrl}/admin/api/2026-07/graphql.json`, {
      method: "POST", redirect: "error", signal,
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });

  async function readFixture() {
    const fixture = await createReader(graphql)<Fixture>(fixtureQuery, { variantId, locationId });
    assert.ok(fixture.shop.plan.partnerDevelopment && fixture.shop.myshopifyDomain === shop,
      "The test only writes inventory on its configured Shopify dev store");
    const variant = fixture.productVariant;
    assert.ok(variant?.sku === "STOCKPILOT-E2E" && variant.inventoryItem.tracked,
      "Expected a tracked fixture variant with SKU STOCKPILOT-E2E");
    const item = variant.inventoryItem;
    const available = item.inventoryLevel?.quantities.find(q => q.name === "available")?.quantity;
    assert.ok(typeof available === "number", "Activate the fixture at the configured location");
    return { itemId: item.id, available };
  }

  const fixture = await readFixture();
  assert.equal(fixture.available, 0, "Set the dedicated fixture to 0 available before running");

  async function adjust(from: number, to: number) {
    const key = randomUUID();
    const result = await createReader(graphql)<{
      inventoryAdjustQuantities: {
        inventoryAdjustmentGroup: { changes: { name: string; delta: number }[] } | null;
        userErrors: { code: string }[];
      };
    }>(adjustQuery, {
      key,
      input: {
        name: "available", reason: "correction",
        referenceDocumentUri: `stockpilot-test://inventory/${key}`,
        changes: [{ inventoryItemId: fixture.itemId, locationId, changeFromQuantity: from, delta: to - from }],
      },
    });
    const adjustment = result.inventoryAdjustQuantities;
    if (adjustment.userErrors.length || !adjustment.inventoryAdjustmentGroup) {
      throw new Error(`Shopify rejected the fixture adjustment (${adjustment.userErrors.map(error => error.code).join(", ") || "no adjustment group"})`);
    }
  }

  let attemptedChange = false;
  try {
    await verifyStockChange({
      shop, variantId, locationId, graphql,
      changeStock: async () => {
        attemptedChange = true;
        await adjust(0, 3);
      },
    });
  } finally {
    if (attemptedChange) {
      const current = await readFixture();
      assert.equal(current.itemId, fixture.itemId, "Fixture inventory item changed during the test");
      if (current.available === 3) await adjust(3, 0);
      assert.equal((await readFixture()).available, 0, "Restoration failed. Check the fixture in Shopify Admin.");
    }
  }
  console.log("Live dev-store test passed. Refresh moved the fixture from Out of stock (100) to Low stock (60), with 12 suggested. The fixture is back at 0.");
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : "Live Shopify test failed");
  process.exitCode = 1;
});

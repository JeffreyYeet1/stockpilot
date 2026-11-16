import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createDashboardService } from "../../app/inventory/dashboard.server";
import { buildRows } from "../../app/inventory/model";
import type { Graphql } from "../../app/inventory/shopify.server";
import { prepareDemoDb } from "../../scripts/demo-db";

export async function verifyStockChange({
  shop, variantId, locationId, graphql, changeStock,
}: {
  shop: string;
  variantId: string;
  locationId: string;
  graphql: Graphql;
  changeStock: () => Promise<void>;
}) {
  const directory = await mkdtemp(join(tmpdir(), "stockpilot-refresh-"));
  const db = new PrismaClient({ datasourceUrl: `file:${join(directory, "snapshot.sqlite")}` });
  try {
    await prepareDemoDb(db);
    const { dashboardAction, loadDashboard } = createDashboardService(db);
    async function readRow() {
      const dashboard = await loadDashboard(shop, graphql);
      assert.equal(dashboard.error, null);
      assert.ok(dashboard.refreshedAt);
      assert.ok(dashboard.inventory);
      const row = buildRows(dashboard.inventory, dashboard.rules, locationId)
        .find(row => row.variant.id === variantId);
      assert.ok(row, "The selected variant must appear in the inventory snapshot");
      return [row.available, row.status, row.score, row.reorder];
    }

    assert.deepEqual(await readRow(), [0, "Out of stock", 100, 15]);
    await changeStock();
    assert.deepEqual(await readRow(), [0, "Out of stock", 100, 15], "warm load uses saved inventory");
    const request = new Request("http://localhost/app", {
      method: "POST",
      body: new URLSearchParams({ intent: "refresh" }),
    });
    assert.equal((await dashboardAction(request, shop, graphql)).error, null);
    assert.deepEqual(await readRow(), [3, "Low stock", 60, 12]);
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}

import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSnapshotCache } from "../app/inventory/cache.server";
import type { Inventory } from "../app/inventory/model";

test("SQLite cold, warm, refresh, failure, coalescing, persistence, and tenant isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stockpilot-test-"));
  const db = new PrismaClient({ datasourceUrl: `file:${join(directory, "test.sqlite")}` });
  try {
    const migration = await readFile(new URL("../prisma/migrations/20261115000000_inventory/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").filter(sql => sql.trim())) await db.$executeRawUnsafe(statement);

    const empty: Inventory = { variants: [], locations: [] };
    let clock = new Date("2026-11-15T12:00:00.000Z");
    const cache = createSnapshotCache(db, () => clock);
    let calls = 0;
    const source = async () => { calls++; return empty; };
    const shop = "one.myshopify.com";
    const [cold, overlapping] = await Promise.all([cache.load(shop, source), cache.load(shop, source)]);
    assert.deepEqual(cold, overlapping);
    assert.deepEqual(cold.inventory, empty);
    assert.equal(cold.refreshedAt, clock.toISOString());
    assert.equal(calls, 1);
    assert.deepEqual(await cache.load(shop, source), cold);
    assert.equal(calls, 1);

    await db.stockRule.create({ data: { shop, sku: "TOTE", threshold: 7, target: 22 } });
    const failure = async () => { throw new Error("token-like upstream detail"); };
    await assert.rejects(cache.refresh(shop, failure));
    const persisted = await createSnapshotCache(db).load(shop, failure);
    assert.equal(persisted.refreshedAt, cold.refreshedAt);
    assert.deepEqual(persisted.inventory, empty);
    assert.deepEqual(persisted.rules, [{ sku: "TOTE", threshold: 7, target: 22 }]);

    const unavailable = await cache.load("two.myshopify.com", failure);
    assert.equal(unavailable.inventory, null);
    assert.equal(unavailable.refreshedAt, null);
    assert.deepEqual(unavailable.rules, []);
    assert.ok(unavailable.error && !unavailable.error.includes("token-like"));
    clock = new Date("2026-11-15T13:00:00.000Z");
    await cache.refresh(shop, source);
    assert.equal((await cache.read(shop)).refreshedAt, clock.toISOString());
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});

import type { PrismaClient } from "@prisma/client";
import type { Inventory } from "./model";

export function createSnapshotCache(db: PrismaClient, now = () => new Date()) {
  const pending = new Map<string, Promise<void>>();

  function refresh(shop: string, fetchInventory: () => Promise<Inventory>) {
    const existing = pending.get(shop);
    if (existing) return existing;
    const task = (async () => {
      const inventory = await fetchInventory();
      const snapshot = { refreshedAt: now(), payload: JSON.stringify(inventory) };
      await db.inventorySnapshot.upsert({ where: { shop }, create: { shop, ...snapshot }, update: snapshot });
    })().finally(() => pending.delete(shop));
    pending.set(shop, task);
    return task;
  }

  async function read(shop: string) {
    const [snapshot, rules] = await Promise.all([
      db.inventorySnapshot.findUnique({ where: { shop } }),
      db.stockRule.findMany({ where: { shop }, select: { sku: true, threshold: true, target: true } }),
    ]);
    return { inventory: snapshot ? JSON.parse(snapshot.payload) as Inventory : null,
      refreshedAt: snapshot?.refreshedAt.toISOString() ?? null, rules };
  }

  async function load(shop: string, fetchInventory: () => Promise<Inventory>) {
    const cached = await read(shop);
    if (cached.inventory) return { ...cached, error: null };
    try {
      await refresh(shop, fetchInventory);
      return { ...await read(shop), error: null };
    } catch (error) {
      if (error instanceof Response) throw error;
      console.warn("StockPilot inventory sync failed");
      return { ...cached, error: "Inventory couldn’t be loaded. Try refreshing in a moment." };
    }
  }

  return { load, read, refresh };
}

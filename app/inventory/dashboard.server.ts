import db from "../db.server";
import { createSnapshotCache } from "./cache.server";
import { fetchInventory, type Graphql } from "./shopify.server";

const cache = createSnapshotCache(db);

export function loadDashboard(shop: string, graphql: Graphql) {
  return cache.load(shop, () => fetchInventory(graphql));
}

export async function dashboardAction(request: Request, shop: string, graphql: Graphql) {
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "refresh") {
    try {
      await cache.refresh(shop, () => fetchInventory(graphql));
      return { message: "Inventory refreshed.", error: null };
    } catch (error) {
      if (error instanceof Response) throw error;
      console.warn("StockPilot inventory refresh failed");
      return { message: null, error: "Refresh failed. Any previously saved inventory is still shown. Try again in a moment." };
    }
  }
  if (intent === "save-rule" || intent === "reset-rule") {
    const sku = String(form.get("sku") ?? "").trim();
    const snapshot = await cache.read(shop);
    if (!sku || !snapshot.inventory?.variants.some(variant => variant.sku?.trim() === sku)) {
      return { message: null, error: "Choose a SKU from the current snapshot." };
    }
    const key = { shop, sku };
    if (intent === "reset-rule") {
      await db.stockRule.deleteMany({ where: key });
      return { message: "Default stock rule restored.", error: null };
    }
    const threshold = wholeNumber(form.get("threshold"));
    const target = wholeNumber(form.get("target"));
    if (threshold === null || target === null || threshold < 1 || target < threshold) {
      return { message: null, error: "Enter a whole-number threshold of at least 1 and a target at or above it (maximum 1,000,000)." };
    }
    const rule = { threshold, target };
    await db.stockRule.upsert({ where: { shop_sku: key }, create: { ...key, ...rule }, update: rule });
    return { message: "Stock rule saved.", error: null };
  }
  return { message: null, error: "Unknown inventory action." };
}

function wholeNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 1_000_000 ? parsed : null;
}

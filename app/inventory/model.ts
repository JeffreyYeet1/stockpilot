export type Location = { id: string; name: string };
export type Variant = {
  id: string;
  title: string;
  product: { id: string; title: string };
  sku: string | null;
  tracked: boolean | null;
  available: Record<string, number | null>;
};
export type Inventory = { locations: Location[]; variants: Variant[] };
export type StockRule = { threshold: number; target: number };
export type SavedRule = StockRule & { sku: string };
export const DEFAULT_RULE: StockRule = { threshold: 5, target: 15 };
export const STALE_MS = 30 * 60 * 1000;
export type Status = "Out of stock" | "Low stock" | "Healthy" | "Unavailable" | "Untracked";

export function assess(available: number | null, tracked: boolean | null, rule: StockRule) {
  const status: Status = tracked === false ? "Untracked" : available === null ? "Unavailable"
    : available <= 0 ? "Out of stock" : available <= rule.threshold ? "Low stock" : "Healthy";
  if (tracked !== true || available === null) return { status, score: null, reorder: null };
  const score = available <= 0 ? 100
    : available > rule.threshold ? 0
    : Math.ceil(99 * (rule.threshold - available + 1) / rule.threshold);
  return { status, score, reorder: Math.max(0, rule.target - available) };
}

export function buildRows(inventory: Inventory, rules: SavedRule[], selectedLocation = "") {
  const overrides = new Map(rules.map(rule => [rule.sku, rule]));
  const locations = selectedLocation
    ? inventory.locations.filter(location => location.id === selectedLocation)
    : inventory.locations;
  return inventory.variants.map(variant => {
    const rule = overrides.get(variant.sku?.trim() ?? "") ?? DEFAULT_RULE;
    const details = locations.map(location => {
      const available = variant.available[location.id] ?? null;
      return { ...location, available, ...assess(available, variant.tracked, rule) };
    });
    const known = details.filter(detail => detail.available !== null);
    const worst = details.reduce<(typeof details)[number] | undefined>((current, detail) => {
      if (detail.score === null) return current;
      return !current || detail.score > (current.score ?? -1) ? detail : current;
    }, undefined);
    return {
      variant, rule, details, covered: known.length,
      status: worst?.status ?? (variant.tracked === false ? "Untracked" : "Unavailable"),
      score: worst?.score ?? null,
      available: known.length ? known.reduce((sum, detail) => sum + (detail.available ?? 0), 0) : null,
      reorder: known.length ? known.reduce((sum, detail) => sum + (detail.reorder ?? 0), 0) : null,
    };
  });
}

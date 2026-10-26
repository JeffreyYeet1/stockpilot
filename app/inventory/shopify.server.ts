import type { Inventory, Location, Variant } from "./model";

export type Graphql = (query: string, options: {
  variables: Record<string, unknown>; tries: number; signal?: AbortSignal;
}) => Promise<Response>;

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Level = { location: Location; quantities: { name: string; quantity: number }[] };
type Item = { id: string; tracked: boolean; inventoryLevels: Connection<Level> };
type ShopifyVariant = Pick<Variant, "id" | "title" | "sku" | "product"> & { inventoryItem: Item | null };
type GraphError = { extensions?: { code?: string } };
type Cost = { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } };
type Envelope<T> = { data?: T; errors?: GraphError[]; extensions?: { cost?: Cost } };

const pageInfo = "pageInfo { hasNextPage endCursor }";
const levelFields = 'location { id name } quantities(names: ["available"]) { name quantity }';

export const LOCATIONS = `query StockPilotLocations($after: String) {
  locations(first: 100, after: $after, includeLegacy: true) {
    nodes { id name } ${pageInfo}
  }
}`;
export const VARIANTS = `query StockPilotVariants($after: String, $levels: Int!) {
  productVariants(first: 35, after: $after, sortKey: ID) {
    nodes {
      id title sku product { id title }
      inventoryItem {
        id tracked
        inventoryLevels(first: $levels) { nodes { ${levelFields} } ${pageInfo} }
      }
    }
    ${pageInfo}
  }
}`;
export const LEVELS = `query StockPilotLevels($id: ID!, $after: String) {
  inventoryItem(id: $id) {
    inventoryLevels(first: 100, after: $after) { nodes { ${levelFields} } ${pageInfo} }
  }
}`;

export class InventoryApiError extends Error {}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type SdkResponse = { code: number; retryAfter?: number };
type SdkError = {
  response?: Response | SdkResponse;
  body?: { errors?: { graphQLErrors?: GraphError[] }; extensions?: { cost?: Cost } };
};

export function createReader(graphql: Graphql, pause = sleep) {
  const queryCosts = new Map<string, number>();
  let bucket: { available: number; rate: number; at: number } | undefined;
  const deadline = Date.now() + 120_000;

  function recordCost(query: string, cost?: Cost) {
    if (cost?.requestedQueryCost) queryCosts.set(query, cost.requestedQueryCost);
    if (cost?.throttleStatus) {
      bucket = { available: cost.throttleStatus.currentlyAvailable,
        rate: cost.throttleStatus.restoreRate, at: Date.now() };
    }
  }

  async function wait(ms: number) {
    if (Date.now() + ms >= deadline) throw new InventoryApiError("Inventory sync deadline exceeded");
    if (ms > 0) await pause(ms);
  }

  return async function read<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const plannedCost = queryCosts.get(query);
      if (bucket && plannedCost && bucket.rate > 0) {
        const restored = (Date.now() - bucket.at) * bucket.rate / 1000;
        await wait(Math.ceil((plannedCost - bucket.available - restored) * 1000 / bucket.rate));
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new InventoryApiError("Inventory sync deadline exceeded");
      let status = 0;
      let retryAfter = 0;
      let errors: GraphError[] = [];
      try {
        const response = await graphql(query, { variables, tries: 1,
          signal: AbortSignal.timeout(Math.min(remaining, 15_000)) });
        status = response.status;
        retryAfter = retryDelay(response);
        if (response.ok) {
          const result = await response.json() as Envelope<T>;
          errors = result.errors ?? [];
          recordCost(query, result.extensions?.cost);
          if (!errors.length && result.data != null) return result.data;
        }
      } catch (error) {
        // The Shopify SDK wraps HTTP status codes and GraphQL bodies differently.
        if (error instanceof Response && ((error.status >= 300 && error.status < 400) ||
            error.headers.has("X-Shopify-Retry-Invalid-Session-Request"))) throw error;
        const detail = typeof error === "object" && error !== null ? error as SdkError : {};
        const response = error instanceof Response ? error : detail.response;
        status = response instanceof Response ? response.status : response?.code ?? status;
        retryAfter = response instanceof Response ? retryDelay(response) : (response?.retryAfter ?? 0) * 1000;
        errors = detail.body?.errors?.graphQLErrors ?? [];
        recordCost(query, detail.body?.extensions?.cost);
      }
      const transient = errors.length
        ? errors.every(error => ["THROTTLED", "INTERNAL_SERVER_ERROR"].includes(error.extensions?.code ?? ""))
        : status === 0 || status === 408 || status === 429 || status >= 500;
      if (!transient || attempt === 3) throw new InventoryApiError("Shopify inventory request failed");
      await wait(Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 1000 * 2 ** attempt));
    }
    throw new InventoryApiError("Shopify inventory request failed");
  };
}

function retryDelay(response: Response) {
  const header = response.headers.get("Retry-After");
  if (!header) return 0;
  return /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 0;
}

export async function* pages<T>(fetchPage: (after: string | null) => Promise<Connection<T>>,
  initialCursor: string | null = null) {
  let cursor = initialCursor;
  const seen = new Set([cursor]);
  while (true) {
    const page = await fetchPage(cursor);
    if (!Array.isArray(page.nodes) || typeof page.pageInfo?.hasNextPage !== "boolean") {
      throw new InventoryApiError("Invalid Shopify page");
    }
    yield page.nodes;
    if (!page.pageInfo.hasNextPage) return;
    cursor = page.pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) throw new InventoryApiError("Shopify pagination did not advance");
    seen.add(cursor);
  }
}

export async function fetchInventory(graphql: Graphql): Promise<Inventory> {
  const read = createReader(graphql);
  const locations = new Map<string, Location>();
  for await (const nodes of pages(async after =>
    (await read<{ locations: Connection<Location> }>(LOCATIONS, { after })).locations)) {
    for (const location of nodes) locations.set(location.id, location);
  }

  // Size the nested connection to the shop while keeping the requested query cost bounded.
  const levelPageSize = Math.max(1, Math.min(8, locations.size));
  const variants = new Map<string, Variant>();
  for await (const nodes of pages(async after =>
    (await read<{ productVariants: Connection<ShopifyVariant> }>(VARIANTS, { after, levels: levelPageSize })).productVariants)) {
    for (const { inventoryItem: item, ...variant } of nodes) {
      const available: Variant["available"] = {};
      if (item?.tracked) {
        const addLevels = (levels: Level[]) => {
          for (const level of levels) {
            if (!locations.has(level.location.id)) continue;
            available[level.location.id] = level.quantities.find(quantity => quantity.name === "available")?.quantity ?? null;
          }
        };
        addLevels(item.inventoryLevels.nodes);
        if (item.inventoryLevels.pageInfo.hasNextPage) {
          const cursor = item.inventoryLevels.pageInfo.endCursor;
          if (!cursor) throw new InventoryApiError("Missing inventory level cursor");
          for await (const levels of pages(async after => {
            const result = await read<{ inventoryItem: Pick<Item, "inventoryLevels"> | null }>(
              LEVELS, { id: item.id, after });
            if (!result.inventoryItem) throw new InventoryApiError("Inventory item changed during sync");
            return result.inventoryItem.inventoryLevels;
          }, cursor)) addLevels(levels);
        }
      }
      variants.set(variant.id, { ...variant, tracked: item?.tracked ?? null, available });
    }
  }
  return { locations: [...locations.values()], variants: [...variants.values()] };
}

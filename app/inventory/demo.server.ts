import { LEVELS, LOCATIONS, VARIANTS, type Graphql } from "./shopify.server";

const locations = [
  { id: "toronto", name: "Toronto Warehouse" },
  { id: "vancouver", name: "Vancouver Store" },
  { id: "montreal", name: "Montréal Store" },
];

const products = [
  ["Everyday Canvas Tote", "Natural", "TOTE-NAT"],
  ["Studio Ceramic Mug", "Oat / 350 ml", "MUG-OAT"],
  ["Ribbed Crew Sock", "Olive / M", "SOCK-OLV"],
  ["Trail Insulated Bottle", "Slate / 750 ml", "BTTL-SLT"],
  ["Weekender Duffel", "Charcoal", "DUFL-CHR"],
  ["Field Notebook", "Sand / A5", "NOTE-SND"],
  ["Market Apron", "Ink / One size", "APRN-INK"],
  ["Sunday Crewneck", "Fog / L", "CREW-FOG"],
  ["Transit Cap", "Moss / One size", "CAP-MOS"],
  ["Coast Bath Towel", "Stone", "TOWL-STN"],
  ["Horizon Sunglasses", "Amber", "SUN-AMB"],
  ["Linen Table Runner", "Natural", "RUN-NAT"],
];

export const DEMO_SHOP = "stockpilot-local-demo";

export function seededGraphql(count = 48, latencyMs = 0): Graphql {
  const quantities = Array.from({ length: count }, (_, index) => {
    const [name, title, sku] = products[index % products.length];
    const series = Math.floor(index / products.length);
    const tracked = index % 19 !== 18;
    const stock = index < 6 ? [index - 2, 14 + index, 22 - index]
      : [8 + (index * 7) % 23, (index * 11) % 26, 6 + (index * 13) % 29];
    return {
      id: `demo-variant-${index}`, title: series ? `${title} / Series ${series + 1}` : title,
      sku: series ? `${sku}-${series + 1}` : sku,
      product: { id: `demo-product-${index % products.length}`, title: name },
      inventoryItem: {
        id: `demo-item-${index}`, tracked,
        inventoryLevels: connection(tracked ? locations.slice(0, index % 13 === 12 ? 2 : 3).map((location, offset) => ({
          location,
          quantities: [{ name: "available", quantity: stock[offset] }],
        })) : [], 8, 0),
      },
    };
  });
  return async (query, { variables }) => {
    if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
    const after = variables.after == null ? 0 : Number(variables.after);
    if (query === LOCATIONS) return Response.json({ data: { locations: connection(locations, 100, after) } });
    if (query === VARIANTS) return Response.json({ data: { productVariants: connection(quantities, 35, after) } });
    if (query === LEVELS) return Response.json({ data: { inventoryItem: null } });
    return new Response(null, { status: 400 });
  };
}

function connection<T>(all: T[], first: number, offset: number) {
  const end = Math.min(offset + first, all.length);
  return { nodes: all.slice(offset, end), pageInfo: { hasNextPage: end < all.length, endCursor: String(end) } };
}

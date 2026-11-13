import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { prepareDemoDb } from "./demo-db";
import { DEMO_SHOP } from "../app/inventory/demo.server";

const directory = await mkdtemp(join(tmpdir(), "stockpilot-benchmark-"));
const databaseUrl = `file:${join(directory, "benchmark.sqlite")}`;
const host = "http://127.0.0.1:4174";
const headers = { "User-Agent": "Mozilla/5.0 StockPilot Benchmark" };
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  SHOPIFY_API_KEY: "stockpilot-demo",
  SHOPIFY_API_SECRET: "local-demo-only",
  SHOPIFY_APP_URL: host,
  STOCKPILOT_DEMO: "1",
  STOCKPILOT_BENCHMARK: "1",
};

async function load() {
  const start = performance.now();
  const response = await fetch(`${host}/demo`, { headers, signal: AbortSignal.timeout(10_000) });
  const firstByte = performance.now() - start;
  assert.equal(response.status, 200);
  const body = await response.text();
  const complete = performance.now() - start;
  assert.ok(body.includes("1,050 variants") && body.includes("Sample inventory"), "Seeded dashboard failed to render");
  return { firstByte, complete };
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });
let server: ReturnType<typeof spawn> | undefined;
try {
  await prepareDemoDb(db);
  server = spawn(process.execPath, [
    "node_modules/@react-router/dev/bin.js", "dev", "--host", "127.0.0.1", "--port", "4174", "--strictPort",
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  let startup = "";
  server.stdout?.on("data", chunk => { startup += chunk; });
  server.stderr?.on("data", chunk => { startup += chunk; });
  for (let attempt = 0; !startup.includes(host); attempt++) {
    if (server.exitCode !== null || attempt >= 100) throw new Error(startup || "Benchmark server did not start");
    await delay(100);
  }
  await load();
  await load();
  const cold: Awaited<ReturnType<typeof load>>[] = [];
  const warm: Awaited<ReturnType<typeof load>>[] = [];
  for (let run = 0; run < 20; run++) {
    await db.inventorySnapshot.deleteMany({ where: { shop: DEMO_SHOP } });
    cold.push(await load());
    const snapshot = await db.inventorySnapshot.findUniqueOrThrow({ where: { shop: DEMO_SHOP } });
    assert.equal(JSON.parse(snapshot.payload).variants.length, 1050);
    warm.push(await load());
    const cached = await db.inventorySnapshot.findUniqueOrThrow({ where: { shop: DEMO_SHOP } });
    assert.equal(cached.refreshedAt.getTime(), snapshot.refreshedAt.getTime());
  }

  function percentiles(samples: number[]) {
    const ordered = [...samples].sort((a, b) => a - b);
    return [0.5, 0.95].map(p => ordered[Math.ceil(ordered.length * p) - 1].toFixed(2));
  }
  console.log(`Node ${process.version}, ${platform()} ${release()} ${arch()}; 20 paired samples`);
  console.table(Object.fromEntries(Object.entries({ cold, warm }).map(([name, samples]) => {
    const [firstByteP50, firstByteP95] = percentiles(samples.map(item => item.firstByte));
    const [completeP50, completeP95] = percentiles(samples.map(item => item.complete));
    return [name, { firstByteP50, firstByteP95, completeP50, completeP95 }];
  })));
} finally {
  if (server && server.exitCode === null) server.kill();
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}

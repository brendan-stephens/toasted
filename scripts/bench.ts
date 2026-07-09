// Raw SQL benchmark: run representative queries against both backends and print
// execution time + buffers side by side.  `npm run bench`
import dotenv from "dotenv";
// ENV_FILE=.env.production npm run bench  -> bench a remote project
dotenv.config({ path: process.env.ENV_FILE ?? ".env.local" });
import postgres from "postgres";

const REMOTE = !!process.env.ENV_FILE;
const sql = postgres(process.env.DATABASE_URL!, {
  max: 2,
  ...(REMOTE ? { prepare: false, ssl: "require" as const } : {}),
});

interface Scenario {
  label: string;
  db: string; // query over cars_db (jsonb)
  storage: string; // equivalent query over cars_storage (columns)
}

const SCENARIOS: Scenario[] = [
  {
    label: "Filter: price <= 40000",
    db: `select count(*) from cars_db where (details->>'price')::numeric <= 40000`,
    storage: `select count(*) from cars_storage where price <= 40000`,
  },
  {
    label: "Filter: horsepower >= 400",
    db: `select count(*) from cars_db where (details->'engine'->>'horsepower')::int >= 400`,
    storage: `select count(*) from cars_storage where horsepower >= 400`,
  },
  {
    label: "Sort by price, first 24",
    db: `select id from cars_db order by (details->>'price')::numeric limit 24`,
    storage: `select id from cars_storage order by price limit 24`,
  },
  {
    label: "Avg price grouped by brand",
    db: `select details->>'brand', avg((details->>'price')::numeric) from cars_db group by 1`,
    storage: `select brand, avg(price) from cars_storage group by 1`,
  },
  {
    label: "Equality: brand = 'BMW' (indexed)",
    db: `select count(*) from cars_db where details->>'brand' = 'BMW'`,
    storage: `select count(*) from cars_storage where brand = 'BMW'`,
  },
];

async function measure(query: string): Promise<{ ms: number; buffers: number }> {
  // warm up, then take the best of three
  let best = { ms: Infinity, buffers: 0 };
  for (let i = 0; i < 3; i++) {
    const rows = await sql.unsafe(`explain (analyze, buffers, format json) ${query}`);
    const plan = (rows[0] as any)["QUERY PLAN"][0];
    const ms = plan["Execution Time"] as number;
    const top = plan["Plan"];
    const buffers = (top["Shared Hit Blocks"] ?? 0) + (top["Shared Read Blocks"] ?? 0);
    if (ms < best.ms) best = { ms, buffers };
  }
  return best;
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number) {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

async function main() {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from cars_db`;
  console.log(`\nTOASTED benchmark — ${n} cars, best of 3 (EXPLAIN ANALYZE)\n`);
  console.log(
    pad("Scenario", 36) + padL("DB (jsonb)", 16) + padL("Storage", 16) + padL("Speedup", 10)
  );
  console.log("-".repeat(78));

  for (const s of SCENARIOS) {
    const d = await measure(s.db);
    const st = await measure(s.storage);
    const speedup = d.ms / st.ms;
    console.log(
      pad(s.label, 36) +
        padL(`${d.ms.toFixed(1)}ms/${d.buffers}b`, 16) +
        padL(`${st.ms.toFixed(2)}ms/${st.buffers}b`, 16) +
        padL(`${speedup.toFixed(0)}x`, 10)
    );
  }
  console.log("\n(b = 8KB buffers touched; lower is better)\n");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

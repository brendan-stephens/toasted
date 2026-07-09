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

interface Stat { ms: number; hit: number; read: number; io: number }

async function explain(query: string): Promise<Stat> {
  const rows = await sql.unsafe(`explain (analyze, buffers, format json) ${query}`);
  const plan = (rows[0] as any)["QUERY PLAN"][0];
  const top = plan["Plan"];
  return {
    ms: plan["Execution Time"] as number,
    hit: top["Shared Hit Blocks"] ?? 0,
    read: top["Shared Read Blocks"] ?? 0,
    io: (top["I/O Read Time"] ?? 0) + (top["I/O Write Time"] ?? 0),
  };
}

// The FIRST run shows physical reads (cold-ish); the best of the next runs is
// steady-state (warm). On EBS the cold `read` count + I/O time is the story.
async function measure(query: string): Promise<{ cold: Stat; warm: Stat }> {
  const cold = await explain(query);
  let warm = cold;
  for (let i = 0; i < 2; i++) {
    const r = await explain(query);
    if (r.ms < warm.ms) warm = r;
  }
  return { cold, warm };
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number) {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

async function main() {
  // best-effort: measure real I/O wait time if the project allows it
  let ioTiming = false;
  try { await sql.unsafe(`set track_io_timing = on`); ioTiming = true; } catch {}

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from cars_db`;
  const [{ sb }] = await sql<{ sb: string }[]>`select current_setting('shared_buffers') sb`;
  console.log(`\nTOASTED benchmark — ${n} cars · shared_buffers ${sb}${ioTiming ? " · io timing on" : ""}`);
  console.log(`cold = first run (physical reads shown); warm = best of next 2\n`);
  console.log(
    pad("Scenario", 30) + padL("DB warm", 11) + padL("DB read", 9) +
    padL("DB io", 9) + padL("Storage", 11) + padL("St.read", 9) + padL("Speedup", 9)
  );
  console.log("-".repeat(88));

  for (const s of SCENARIOS) {
    const d = await measure(s.db);
    const st = await measure(s.storage);
    const speedup = d.warm.ms / st.warm.ms;
    console.log(
      pad(s.label, 30) +
        padL(`${d.warm.ms.toFixed(1)}ms`, 11) +
        padL(`${d.cold.read}`, 9) +
        padL(ioTiming ? `${d.cold.io.toFixed(0)}ms` : "—", 9) +
        padL(`${st.warm.ms.toFixed(2)}ms`, 11) +
        padL(`${st.cold.read}`, 9) +
        padL(`${speedup.toFixed(0)}x`, 9)
    );
  }
  console.log(`\nread = 8KB pages read from disk on the cold run · io = time waiting on that I/O`);
  console.log(`(local NVMe hides this; on EBS the DB 'read'/'io' columns are the real cost)\n`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Inflate the cars tables server-side to a target row count by cloning the
// existing base rows with id offsets. No network transfer — this is how we grow
// the on-disk TOAST past the instance's RAM so scans actually hit EBS.
//
//   ENV_FILE=.env.production npm run inflate -- 500000
import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE ?? ".env.local" });
import postgres from "postgres";

const TARGET = Number(process.argv[2] ?? 500000);
const REMOTE = !!process.env.ENV_FILE;
const sql = postgres(process.env.DATABASE_URL!, {
  max: 2,
  ...(REMOTE ? { prepare: false, ssl: "require" as const } : {}),
});

async function main() {
  const [{ base }] = await sql<{ base: number }[]>`select count(*)::int base from cars_db`;
  if (base === 0) throw new Error("cars_db is empty — run the seed first");
  const [{ maxid }] = await sql<{ maxid: number }[]>`select coalesce(max(id),0)::int maxid from cars_db`;
  if (maxid !== base) throw new Error(`expected contiguous ids 1..${base}, got max ${maxid}`);

  console.log(`Base ${base} rows → inflating to ${TARGET}…`);
  let current = base;
  let round = 1;
  while (current < TARGET) {
    const offset = round * base;
    const limit = Math.min(base, TARGET - current);
    // clone the ORIGINAL base (id <= base) each round, shifted by `offset`
    await sql`
      insert into cars_db (id, name, details)
      select id + ${offset}, name, details from cars_db where id <= ${base} order by id limit ${limit}`;
    await sql`
      insert into cars_storage (id, name, brand, model, year, trim, price, body_type,
        exterior_color, fuel_type, transmission, drivetrain, seats, horsepower, details_path)
      select id + ${offset}, name, brand, model, year, trim, price, body_type,
        exterior_color, fuel_type, transmission, drivetrain, seats, horsepower, details_path
      from cars_storage where id <= ${base} order by id limit ${limit}`;
    current += limit;
    round++;
    process.stdout.write(`\r  ${current}/${TARGET} rows`);
  }
  console.log("");

  console.log("Analyzing…");
  await sql`analyze cars_db`;
  await sql`analyze cars_storage`;

  const [sz] = await sql<{ heap: string; toast: string; ram_note: string }[]>`
    select pg_size_pretty(pg_relation_size('cars_db')) heap,
           pg_size_pretty(pg_total_relation_size('cars_db') - pg_relation_size('cars_db')
                          - pg_indexes_size('cars_db')) toast,
           current_setting('shared_buffers') ram_note`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from cars_db`;
  console.log(`Done. cars_db = ${n} rows · heap ${sz.heap} · TOAST ${sz.toast} · shared_buffers ${sz.ram_note}`);
  await sql.end();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

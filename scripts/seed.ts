// Seed both backends with the SAME cars:
//   - cars_db      : full spec document in a jsonb column
//   - cars_storage : promoted filter columns + the full spec as a bucket file
//
//   npm run seed            # 2000 cars
//   npm run seed -- 5000    # more cars
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { buildCar } from "../lib/cars-data";

const COUNT = Number(process.argv[2] ?? 2000);
const BUCKET = process.env.CAR_DETAILS_BUCKET ?? "car-details";

const DATABASE_URL = process.env.DATABASE_URL!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!DATABASE_URL || !SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing env — check .env.local (DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
}

const sql = postgres(DATABASE_URL, { max: 8 });
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function mapLimit<T>(items: T[], limit: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    })
  );
}

async function main() {
  console.log(`Seeding ${COUNT} cars…`);

  // 1. bucket (public so the app can GET spec files directly)
  const { error: bucketErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "1MB",
  });
  if (bucketErr && !/already exists/i.test(bucketErr.message)) throw bucketErr;
  console.log(`Bucket "${BUCKET}" ready.`);

  // 2. build every car up front (deterministic from id)
  const cars = Array.from({ length: COUNT }, (_, i) => {
    const id = i + 1;
    const { name, details, row } = buildCar(id);
    return { id, name, details, row, path: `cars/${id}.json` };
  });

  // 3. reset + bulk insert both tables
  await sql`truncate cars_db, cars_storage`;

  const BATCH = 500;
  for (let i = 0; i < cars.length; i += BATCH) {
    const chunk = cars.slice(i, i + BATCH);
    await sql`insert into cars_db ${sql(
      // details is jsonb; postgres.js serialises the object automatically
      chunk.map((c) => ({ id: c.id, name: c.name, details: c.details as object })) as any,
      "id",
      "name",
      "details"
    )}`;
    await sql`insert into cars_storage ${sql(
      chunk.map((c) => ({ id: c.id, ...c.row, details_path: c.path })),
      "id", "name", "brand", "model", "year", "trim", "price", "body_type",
      "exterior_color", "fuel_type", "transmission", "drivetrain", "seats",
      "horsepower", "details_path"
    )}`;
    process.stdout.write(`\r  inserted ${Math.min(i + BATCH, cars.length)}/${cars.length} rows`);
  }
  console.log("");

  // 4. upload each car's full spec JSON to the bucket
  let uploaded = 0;
  await mapLimit(cars, 24, async (c) => {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(c.path, JSON.stringify(c.details), {
        contentType: "application/json",
        upsert: true,
      });
    if (error) throw error;
    if (++uploaded % 100 === 0 || uploaded === cars.length) {
      process.stdout.write(`\r  uploaded ${uploaded}/${cars.length} spec files`);
    }
  });
  console.log("");

  // 5. refresh planner stats
  await sql`analyze cars_db`;
  await sql`analyze cars_storage`;

  // 6. quick sanity: how big are the docs, and did they TOAST?
  const [{ avg_bytes, toasted }] = await sql<{ avg_bytes: number; toasted: number }[]>`
    select avg(pg_column_size(details))::int as avg_bytes,
           count(*) filter (where pg_column_size(details) > 2000) as toasted
    from cars_db`;
  console.log(`Done. avg jsonb size = ${avg_bytes} bytes, ${toasted}/${COUNT} rows TOASTed.`);

  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

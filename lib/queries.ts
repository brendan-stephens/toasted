import "server-only";
import { sql } from "./db";
import { fetchDetailsFromStorage } from "./storage";
import { PAGE_SIZE } from "./cars-data";
import type { Backend, CarDetails, CarFilters, CarRow, QueryResult } from "./types";

// Cap for the "download files and filter in the app" path so a pathological
// filter can't try to pull tens of thousands of objects. We surface truncation.
const STORAGE_SCAN_CAP = 800;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function orderByDb(sort: CarFilters["sort"]) {
  if (sort === "price_asc") return sql`(details->>'price')::numeric asc`;
  if (sort === "price_desc") return sql`(details->>'price')::numeric desc`;
  return sql`(details->'engine'->>'horsepower')::int desc`;
}
function orderByStorage(sort: CarFilters["sort"]) {
  if (sort === "price_asc") return sql`price asc`;
  if (sort === "price_desc") return sql`price desc`;
  return sql`horsepower desc`;
}

const CARD_COLS_DB = sql`
  id, name,
  details->>'brand'                        as brand,
  details->>'model'                        as model,
  (details->>'year')::int                  as year,
  details->>'trim'                         as trim,
  (details->>'price')::numeric::float8     as price,
  details->>'body_type'                    as body_type,
  details->>'exterior_color'               as exterior_color,
  details->>'fuel_type'                    as fuel_type,
  details->>'transmission'                 as transmission,
  details->>'drivetrain'                   as drivetrain,
  (details->>'seats')::int                 as seats,
  (details->'engine'->>'horsepower')::int  as horsepower`;

// ---------------------------------------------------------------------------
// Database backend — everything is filtered/sorted/projected out of the jsonb
// column, which forces detoasting of the (TOASTed) documents.
// ---------------------------------------------------------------------------
async function queryDb(f: CarFilters): Promise<QueryResult> {
  const conds = [];
  if (f.brand) conds.push(sql`details->>'brand' = ${f.brand}`);
  if (f.bodyType) conds.push(sql`details->>'body_type' = ${f.bodyType}`);
  if (f.fuelType) conds.push(sql`details->>'fuel_type' = ${f.fuelType}`);
  if (f.minHorsepower != null) conds.push(sql`(details->'engine'->>'horsepower')::int >= ${f.minHorsepower}`);
  if (f.maxPrice != null) conds.push(sql`(details->>'price')::numeric <= ${f.maxPrice}`);
  if (f.features.length) conds.push(sql`details @> ${sql.json({ features: f.features })}`);
  const where = conds.length ? conds.reduce((a, b) => sql`${a} and ${b}`) : sql`true`;

  const t0 = performance.now();
  const [{ c: total }] = await sql<{ c: number }[]>`
    select count(*)::int as c from cars_db where ${where}`;
  const rows = await sql<CarRow[]>`
    select ${CARD_COLS_DB} from cars_db
    where ${where} order by ${orderByDb(f.sort)}
    limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`;
  const ms = performance.now() - t0;

  return {
    rows,
    total,
    ms,
    explain:
      "One SQL query over cars_db. Every predicate, the ORDER BY, and the " +
      "count read keys out of the jsonb column. Because the documents are " +
      "TOASTed, those values live out-of-line in a separate table on disk — so " +
      "Postgres must read the TOAST chunks off disk and decompress them to " +
      "inspect a row, an I/O cost you pay even to read one small key. Equality " +
      "on brand/body_type can use the expression/GIN indexes; the price/" +
      "horsepower range and sort cannot.",
  };
}

// ---------------------------------------------------------------------------
// Storage backend (hybrid) — filter/sort on real indexed columns. The big spec
// blob is never touched here; it only lives in the bucket.
// ---------------------------------------------------------------------------
async function queryStorageColumns(f: CarFilters): Promise<QueryResult> {
  const conds = [];
  if (f.brand) conds.push(sql`brand = ${f.brand}`);
  if (f.bodyType) conds.push(sql`body_type = ${f.bodyType}`);
  if (f.fuelType) conds.push(sql`fuel_type = ${f.fuelType}`);
  if (f.minHorsepower != null) conds.push(sql`horsepower >= ${f.minHorsepower}`);
  if (f.maxPrice != null) conds.push(sql`price <= ${f.maxPrice}`);
  const where = conds.length ? conds.reduce((a, b) => sql`${a} and ${b}`) : sql`true`;

  const t0 = performance.now();
  const [{ c: total }] = await sql<{ c: number }[]>`
    select count(*)::int as c from cars_storage where ${where}`;
  const rows = await sql<CarRow[]>`
    select id, name, brand, model, year, trim, price::float8 as price, body_type,
           exterior_color, fuel_type, transmission, drivetrain, seats, horsepower
    from cars_storage
    where ${where} order by ${orderByStorage(f.sort)}
    limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`;
  const ms = performance.now() - t0;

  return {
    rows,
    total,
    ms,
    explain:
      "One SQL query over cars_storage against small, indexed columns. The big " +
      "spec blob stays in the bucket and is never read, so there is nothing to " +
      "detoast.",
  };
}

// The trap: a "deep" spec (a value in the `features` array) is NOT a column in
// the Storage backend — it only exists inside the blob in the bucket. Answering
// it means narrowing by columns, then DOWNLOADING each candidate's file and
// scanning it in the app. This is the cost of leaving queryable data in storage.
async function queryStorageWithFeature(f: CarFilters): Promise<QueryResult> {
  const conds = [];
  if (f.brand) conds.push(sql`brand = ${f.brand}`);
  if (f.bodyType) conds.push(sql`body_type = ${f.bodyType}`);
  if (f.fuelType) conds.push(sql`fuel_type = ${f.fuelType}`);
  if (f.minHorsepower != null) conds.push(sql`horsepower >= ${f.minHorsepower}`);
  if (f.maxPrice != null) conds.push(sql`price <= ${f.maxPrice}`);
  const where = conds.length ? conds.reduce((a, b) => sql`${a} and ${b}`) : sql`true`;

  const t0 = performance.now();
  const candidates = await sql<(CarRow & { details_path: string })[]>`
    select id, name, brand, model, year, trim, price::float8 as price, body_type,
           exterior_color, fuel_type, transmission, drivetrain, seats, horsepower,
           details_path
    from cars_storage where ${where} order by ${orderByStorage(f.sort)}`;

  const truncated = candidates.length > STORAGE_SCAN_CAP;
  const scanned = candidates.slice(0, STORAGE_SCAN_CAP);
  const withDocs = await mapLimit(scanned, 24, async (c) => {
    const d = (await fetchDetailsFromStorage(c.details_path)) as CarDetails;
    return { car: c, hit: f.features.every((ft) => d.features.includes(ft)) };
  });
  const matches = withDocs.filter((x) => x.hit).map((x) => x.car);
  const ms = performance.now() - t0;

  const start = (f.page - 1) * PAGE_SIZE;
  const n = f.features.length;
  return {
    rows: matches.slice(start, start + PAGE_SIZE).map(({ details_path, ...r }) => r),
    total: matches.length,
    ms,
    explain:
      `The ${n === 1 ? "feature filter targets a value" : `${n} feature filters target values`} ` +
      `inside the spec blob, which lives in the bucket — not a column. So we ` +
      `filter by columns (${candidates.length} candidates), then download ` +
      `${scanned.length} JSON files from Storage and scan them in the app` +
      (truncated ? ` (capped at ${STORAGE_SCAN_CAP}; results truncated).` : `.`) +
      ` This is exactly why you keep queryable fields in the database.`,
    unsupported: truncated,
  };
}

export async function queryCars(backend: Backend, f: CarFilters): Promise<QueryResult> {
  if (backend === "db") return queryDb(f);
  if (f.features.length) return queryStorageWithFeature(f);
  return queryStorageColumns(f);
}

// ---------------------------------------------------------------------------
// Single-car detail: the whole spec document.
// ---------------------------------------------------------------------------
export interface CarDetailResult {
  id: number;
  name: string;
  details: CarDetails;
  ms: number;
  explain: string;
}

export async function getCar(backend: Backend, id: number): Promise<CarDetailResult | null> {
  if (backend === "db") {
    const t0 = performance.now();
    const rows = await sql<{ name: string; details: CarDetails }[]>`
      select name, details from cars_db where id = ${id}`;
    const ms = performance.now() - t0;
    if (!rows.length) return null;
    return {
      id,
      name: rows[0].name,
      details: rows[0].details,
      ms,
      explain: "SELECT details FROM cars_db WHERE id = $1 — detoasts one document from the heap.",
    };
  }

  const t0 = performance.now();
  const rows = await sql<{ name: string; details_path: string }[]>`
    select name, details_path from cars_storage where id = ${id}`;
  if (!rows.length) return null;
  const details = (await fetchDetailsFromStorage(rows[0].details_path)) as CarDetails;
  const ms = performance.now() - t0;
  return {
    id,
    name: rows[0].name,
    details,
    ms,
    explain:
      "SELECT details_path FROM cars_storage WHERE id = $1, then one HTTP GET of " +
      "the JSON file from the Storage bucket. Great for fetch-by-key.",
  };
}

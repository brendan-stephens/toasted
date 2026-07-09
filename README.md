# 🍞 TOASTED

A sample Supabase app that benchmarks the same data stored two ways:

- **Database** — the full car spec sheet lives in a Postgres `jsonb` column.
- **Storage** — a hybrid layout: the fields you filter/sort on are promoted to
  real, indexed columns, and the big spec document lives as a JSON file in a
  Supabase **Storage** bucket.

Flip a toggle in the UI and watch the query time change for the *same* filter.

Cars are the domain on purpose: a realistic spec sheet (engine, dimensions,
economy, a long features list, options, colours, dealer stock…) is a few KB —
big enough that **every** document gets **TOASTed** in the database backend.

Background reading:
- Supabase — [Querying JSON data](https://supabase.com/docs/guides/database/json)
- Logto — [Mastering PostgreSQL JSONB](https://blog.logto.io/mastering-postgresql-jsonb)
- Snowflake — [Postgres JSONB columns and TOAST](https://www.snowflake.com/en/blog/engineering/postgres-jsonb-columns-and-toast/)

## What is TOAST?

**T**he **O**versized-**A**ttribute **S**torage **T**echnique. A Postgres row
must fit in an 8KB page, so when a row grows past ~2KB, Postgres compresses large
values (`text`, `json`, `jsonb`, arrays…) and, if needed, moves them out-of-line
into a hidden per-table *TOAST table*, leaving an ~18-byte pointer inline.

The catch: TOAST is **all-or-nothing per value**. To read one key out of a
TOASTed `jsonb` document, Postgres fetches every chunk from the TOAST table and
decompresses the **whole** value — even for one small scalar. And because the
value lives out-of-line, that fetch is a **read from disk** (the separate TOAST
relation): an I/O cost you pay on every row you inspect, even for one small key.
So a query that filters or sorts on a spec has to detoast the documents it
inspects.

The Storage backend sidesteps this by keeping queryable fields as small columns
and parking the big blob in object storage — but then those blob fields can't be
queried in SQL at all (see the "deep spec" filter below).

## Quickstart

```bash
supabase start                 # local stack (ports live in supabase/config.toml)
supabase db reset              # apply the cars schema
npm install
npm run seed                   # 2000 cars: fills both tables + uploads spec files
# npm run seed -- 5000         # more cars = bigger numbers, slower seed

npm run dev                    # http://localhost:3010
npm run bench                  # raw EXPLAIN ANALYZE comparison in the terminal
```

> `supabase/config.toml` uses ports in the `554xx` range so this can run
> alongside another local Supabase project. The app is on port `3010`.

## How it works

Two tables hold the same cars (`supabase/migrations/…_cars_schema.sql`):

| | `cars_db` (Database) | `cars_storage` (Storage) |
|---|---|---|
| Spec document | whole thing in a `jsonb` column (TOASTed) | JSON file in the `car-details` bucket |
| Filterable fields | read out of the jsonb (detoast) | promoted to indexed columns |
| Indexes | GIN + expression idx on brand/body_type | btree on brand, body_type, price, hp |

The app (`app/`) reads `?backend=db|storage`, runs the query in
[`lib/queries.ts`](lib/queries.ts), and shows the **server-side query time** in
the banner. The detail page (`/cars/[id]`) fetches the full spec — a `jsonb`
select vs an HTTP GET from the bucket.

## Results

`npm run bench`, 2000 cars, best of 3 (`EXPLAIN ANALYZE`), Postgres 17. Absolute
numbers vary; the ratios are the point. `b` = 8KB buffers touched.

| Filter | DB (jsonb) | Storage | Speedup |
|---|---|---|---|
| `price <= 40000` | 10.8 ms / 6116 b | 0.03 ms / 4 b | **349×** |
| `horsepower >= 400` | 9.2 ms / 6116 b | 0.05 ms / 5 b | **184×** |
| Sort by price, first 24 | 7.6 ms / 6116 b | 0.01 ms / 25 b | **687×** |
| Avg price grouped by brand | 13.6 ms / 12212 b | 0.21 ms / 40 b | **65×** |
| `brand = 'BMW'` (indexed both) | 0.03 ms / 22 b | 0.01 ms / 3 b | ~2× |

The Database backend reads ~6116 buffers on almost every query — that's it
detoasting all 2000 documents to inspect one field. The Storage backend answers
from tiny indexed columns and touches a handful of pages.

**But it's not one-directional.** Two cases where the database wins or storage
has a catch:

- **Fetch one full spec by id** (detail page): `jsonb` ≈ **1.3 ms** vs a Storage
  bucket GET ≈ **11 ms**. Detoasting a single row beats an HTTP round-trip.
- **Index the jsonb expression** and the gap collapses — the `brand = 'BMW'`
  row above is ~2× because `cars_db` has an expression index on
  `(details->>'brand')`. Indexed access doesn't need to detoast.
- **Filter "deep" specs** (values in the `features` array — the multi-select
  *Features* filter in the UI; multiple picks are AND-ed): the Database does it
  in one indexed SQL query (~70 ms via the GIN index). The Storage backend
  **can't** — `features` is inside the blob, not a column — so it downloads and
  scans the candidate files in the app (**hundreds of ms to seconds**). This is
  the whole lesson in one filter.

## Real-world: cloud EBS vs local NVMe

The numbers above were measured locally on NVMe with 2,000 rows — a dataset that
fits entirely in cache, so the "detoast" cost was really just CPU decompression.
That **understates** the problem. In production your storage is network-attached
(EBS), and once the TOAST heap is larger than RAM, every scan re-reads it from
disk.

To show that, we seeded a real Supabase project (us-west-2, ~1 GB RAM —
`shared_buffers` 256 MB, `effective_cache_size` 768 MB) and inflated to **500,000
cars ≈ 1.33 GB of TOAST**, comfortably larger than RAM (`npm run inflate`).

`ENV_FILE=.env.production npm run bench`:

| Filter | DB (jsonb) | Storage | Speedup |
|---|---|---|---|
| `price <= 40000` | **10,645 ms** · 1.37 GB read | 29.5 ms | **361×** |
| `horsepower >= 400` | **10,704 ms** · 1.37 GB read | 51 ms | **209×** |
| Sort by price, first 24 | **10,682 ms** · 1.37 GB read | 0.08 ms | **136,949×** |
| Avg price grouped by brand | **15,709 ms** · 1.37 GB read | 216 ms | **73×** |
| `brand = 'BMW'` (indexed both) | 29 ms · 0 MB read | 13.9 ms | ~2× |

The same `jsonb` filter that took **~10 ms locally takes ~10.7 seconds** here —
roughly **1000× slower** — because each scan pulls ~1.36 GB of TOAST off EBS, and
it does so on *every* run (the working set can't be cached). The columnar Storage
backend answers from small indexed columns in tens of milliseconds regardless.
And the indexed `brand` lookup stays fast (27 ms) — an index avoids the detoast
entirely.

> On this managed instance `track_io_timing` couldn't be enabled, so we report
> bytes read per scan instead of I/O wait time; the constant read volume across
> warm runs is the evidence that it's disk-bound, not cached.

## Takeaways

1. **Store the payload in `jsonb`; query it from columns.** Promote the fields
   you filter/sort/aggregate on to real columns (or `STORED` generated columns).
2. **Reading a key from a large `jsonb` isn't free** — it detoasts and
   decompresses the entire document, reading its chunks from the out-of-line
   TOAST table on disk. That I/O is unavoidable per row. Fine occasionally,
   deadly in a hot filter.
3. **Storage is great for offloading large, whole-blob payloads** you fetch by
   key (cheap bytes, CDN-friendly) — but anything left in the blob is invisible
   to SQL. You can't `WHERE` your way into an object-storage file.
4. **If you must query `jsonb`, index the access path** — an expression index
   for scalars, a GIN index (`jsonb_path_ops`) for containment/existence.

## Layout

```
supabase/migrations/…_cars_schema.sql   cars_db (jsonb) + cars_storage (hybrid)
lib/cars-data.ts                         deterministic car spec generator
lib/queries.ts                           the two backends, timed
scripts/seed.ts                          fill both tables + upload spec files
scripts/bench.ts                         raw EXPLAIN ANALYZE comparison
app/                                     Next.js UI (list, filters, toggle, detail)
```

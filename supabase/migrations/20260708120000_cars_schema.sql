-- ============================================================================
-- TOASTED — cars sample app schema
-- ----------------------------------------------------------------------------
-- Two ways to store the same cars, so the app can benchmark them side by side:
--
--   cars_db       "Database" backend. The entire spec sheet lives in a single
--                 jsonb column. Rich spec docs push every row past the ~2KB
--                 TOAST threshold, so `details` is compressed + stored
--                 out-of-line. Filtering/sorting on a spec has to detoast the
--                 whole document.
--
--   cars_storage  "Storage" backend (hybrid). The handful of fields you filter
--                 and sort on are promoted to real, indexed Postgres columns.
--                 The full spec document lives as a JSON file in a Supabase
--                 Storage bucket (see scripts/seed.ts); the row only keeps a
--                 pointer to it. Filtering never touches the big blob; the full
--                 doc is fetched from the bucket only on the detail page.
--
-- Data is loaded by `npm run seed` (NOT seed.sql) because the Storage backend
-- has to upload files to the bucket, which SQL can't do.
--
-- Background:
--   https://supabase.com/docs/guides/database/json
--   https://blog.logto.io/mastering-postgresql-jsonb
--   https://www.snowflake.com/en/blog/engineering/postgres-jsonb-columns-and-toast/
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Database backend: everything in one jsonb column.
-- ----------------------------------------------------------------------------
create table public.cars_db (
  id      bigint primary key,
  name    text  not null,
  details jsonb not null
);

-- Containment / key-existence filters (details @> '{...}', details->'features' ? 'x')
-- can use this index. Range filters and ORDER BY on scalar keys cannot, so they
-- still detoast — which is exactly the cost this demo highlights.
create index cars_db_details_gin on public.cars_db using gin (details jsonb_path_ops);

-- A couple of expression indexes for the common equality filters, to keep the
-- comparison fair (the Database backend isn't deliberately hobbled).
create index cars_db_brand_idx     on public.cars_db ((details->>'brand'));
create index cars_db_body_type_idx on public.cars_db ((details->>'body_type'));

-- ----------------------------------------------------------------------------
-- Storage backend (hybrid): promoted filter columns + a pointer to the bucket.
-- The big spec document is NOT stored here; it lives in Storage.
-- ----------------------------------------------------------------------------
create table public.cars_storage (
  id              bigint primary key,
  name            text    not null,
  brand           text    not null,
  model           text    not null,
  year            integer not null,
  trim            text    not null,
  price           numeric(10,2) not null,
  body_type       text    not null,
  exterior_color  text    not null,
  fuel_type       text    not null,
  transmission    text    not null,
  drivetrain      text    not null,
  seats           integer not null,
  horsepower      integer not null,
  -- object path of the full spec JSON in the `car-details` Storage bucket,
  -- e.g. 'cars/1234.json'
  details_path    text    not null
);

create index cars_storage_brand_idx      on public.cars_storage (brand);
create index cars_storage_body_type_idx  on public.cars_storage (body_type);
create index cars_storage_price_idx      on public.cars_storage (price);
create index cars_storage_horsepower_idx on public.cars_storage (horsepower);

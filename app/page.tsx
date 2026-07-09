import Link from "next/link";
import FilterBar from "../components/FilterBar";
import { parseBackend, parseFilters } from "../lib/filters";
import { queryCars } from "../lib/queries";
import { PAGE_SIZE } from "../lib/cars-data";
import type { Backend } from "../lib/types";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function usd(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function hrefWith(sp: SP, overrides: Record<string, string>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => x && p.append(k, x));
    else if (typeof v === "string" && v) p.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) p.set(k, v);
  return `/?${p.toString()}`;
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const backend: Backend = parseBackend(sp);
  const filters = parseFilters(sp);
  const result = await queryCars(backend, filters);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const qsForCard = new URLSearchParams({ backend }).toString();

  return (
    <>
      <header className="site">
        <h1>🍞 <span className="toast">TOASTED</span></h1>
        <p>Same cars, two backends: specs in Postgres <code>jsonb</code> vs Supabase Storage.</p>
        <div style={{ marginLeft: "auto" }}>
          <div className="toggle">
            <Link href={hrefWith(sp, { backend: "db", page: "1" })} data-b="db"
              className={backend === "db" ? "active" : ""}>Database</Link>
            <Link href={hrefWith(sp, { backend: "storage", page: "1" })} data-b="storage"
              className={backend === "storage" ? "active" : ""}>Storage</Link>
          </div>
        </div>
      </header>

      <div className="layout">
        <FilterBar backend={backend} filters={filters} />

        <main>
          <div className="banner">
            <div className="ms">{result.ms.toFixed(1)}<small> ms</small></div>
            <span className={`pill ${backend}`}>{backend === "db" ? "jsonb" : "storage"}</span>
            <div className="ms" style={{ fontSize: 15, fontWeight: 600 }}>
              {result.total.toLocaleString()} <small>matches</small>
            </div>
            <div className={`explain ${result.unsupported ? "warn" : ""}`}>{result.explain}</div>
          </div>

          {result.rows.length === 0 ? (
            <div className="empty">No cars match these filters.</div>
          ) : (
            <div className="grid">
              {result.rows.map((c) => (
                <Link key={c.id} href={`/cars/${c.id}?${qsForCard}`} className="card">
                  <div className="name">{c.name}</div>
                  <div className="brand">{c.brand} · {c.body_type}</div>
                  <div className="price">{usd(c.price)}</div>
                  <div className="specs">
                    <span className="tag">{c.horsepower} hp</span>
                    <span className="tag">{c.fuel_type}</span>
                    <span className="tag">{c.drivetrain}</span>
                    <span className="tag">{c.seats} seats</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div className="pager">
            {filters.page > 1
              ? <Link href={hrefWith(sp, { page: String(filters.page - 1) })}>← Prev</Link>
              : <span>← Prev</span>}
            <span>Page {filters.page} / {totalPages}</span>
            {filters.page < totalPages
              ? <Link href={hrefWith(sp, { page: String(filters.page + 1) })}>Next →</Link>
              : <span>Next →</span>}
          </div>
        </main>
      </div>
    </>
  );
}

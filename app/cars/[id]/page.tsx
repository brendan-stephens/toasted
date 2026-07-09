import Link from "next/link";
import { notFound } from "next/navigation";
import { getCar } from "../../../lib/queries";
import { parseBackend } from "../../../lib/filters";
import type { Backend } from "../../../lib/types";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function usd(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function KV({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return <div className="kv"><span>{k}</span><span>{v}</span></div>;
}

export default async function CarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const backend: Backend = parseBackend(sp);

  const car = await getCar(backend, Number(id));
  if (!car) notFound();
  const d = car.details;

  return (
    <>
      <Link className="back" href={`/?backend=${backend}`}>← Back to results</Link>

      <div className="detail-head">
        <div>
          <h1 style={{ margin: "0 0 4px" }}>{car.name}</h1>
          <div style={{ color: "var(--muted)" }}>{d.body_type} · {d.exterior_color} · {d.drivetrain}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent)" }}>{usd(d.price)}</div>
          <span className={`pill ${backend}`} style={{ display: "inline-block", marginTop: 6 }}>
            {backend === "db" ? "jsonb" : "storage"} · {car.ms.toFixed(1)} ms
          </span>
        </div>
      </div>

      <div className="banner" style={{ marginBottom: 18 }}>
        <div className="explain">{car.explain}</div>
      </div>

      <div className="detail-grid">
        <div className="spec-block">
          <h3>Overview</h3>
          <KV k="Brand" v={d.brand} />
          <KV k="Model" v={d.model} />
          <KV k="Year" v={d.year} />
          <KV k="Trim" v={d.trim} />
          <KV k="Fuel" v={d.fuel_type} />
          <KV k="Transmission" v={d.transmission} />
          <KV k="Seats" v={d.seats} />
        </div>

        <div className="spec-block">
          <h3>Engine</h3>
          <KV k="Type" v={d.engine.type} />
          <KV k="Displacement" v={`${d.engine.displacement_l} L`} />
          <KV k="Cylinders" v={d.engine.cylinders || "—"} />
          <KV k="Horsepower" v={`${d.engine.horsepower} hp`} />
          <KV k="Torque" v={`${d.engine.torque_nm} Nm`} />
          <KV k="Aspiration" v={d.engine.aspiration} />
        </div>

        <div className="spec-block">
          <h3>Performance</h3>
          <KV k="Top speed" v={`${d.performance.top_speed_mph} mph`} />
          <KV k="0–60 mph" v={`${d.performance.zero_to_sixty_s} s`} />
          <KV k="¼ mile" v={`${d.performance.quarter_mile_s} s`} />
          <KV k="City / Hwy" v={`${d.fuel_economy.city_mpg} / ${d.fuel_economy.highway_mpg} mpg`} />
        </div>

        <div className="spec-block">
          <h3>Dimensions</h3>
          <KV k="Length" v={`${d.dimensions.length_mm} mm`} />
          <KV k="Width" v={`${d.dimensions.width_mm} mm`} />
          <KV k="Wheelbase" v={`${d.dimensions.wheelbase_mm} mm`} />
          <KV k="Curb weight" v={`${d.dimensions.curb_weight_kg} kg`} />
          <KV k="Cargo" v={`${d.dimensions.cargo_l} L`} />
        </div>

        <div className="spec-block" style={{ gridColumn: "1 / -1" }}>
          <h3>Features ({d.features.length})</h3>
          <div className="chips">
            {d.features.map((ft) => <span key={ft} className="tag">{ft}</span>)}
          </div>
        </div>

        <div className="spec-block">
          <h3>Options</h3>
          {d.options.map((o) => <KV key={o.code} k={o.name} v={usd(o.price)} />)}
        </div>

        <div className="spec-block">
          <h3>Available colors</h3>
          {d.available_colors.map((c) => (
            <KV key={c.name} k={
              <span><span style={{
                display: "inline-block", width: 10, height: 10, borderRadius: 3,
                background: c.hex, marginRight: 6, border: "1px solid var(--border)",
              }} />{c.name}</span>
            } v={c.price ? `+${usd(c.price)}` : "incl."} />
          ))}
        </div>

        <div className="spec-block">
          <h3>Warranty & safety</h3>
          <KV k="Basic warranty" v={`${d.warranty.basic_years} yr`} />
          <KV k="Powertrain" v={`${d.warranty.powertrain_years} yr`} />
          <KV k="NCAP" v={`${"★".repeat(d.safety.ncap_stars)}`} />
          <KV k="Airbags" v={d.safety.airbags} />
        </div>

        <div className="spec-block" style={{ gridColumn: "1 / -1" }}>
          <h3>Dealer stock ({d.dealer_stock.length})</h3>
          <div className="chips">
            {d.dealer_stock.map((s) => (
              <span key={s.vin} className="tag">{s.vin} · {s.status}</span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

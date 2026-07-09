"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BRAND_LIST, BODY_TYPES, FUEL_TYPES, FEATURE_POOL } from "../lib/cars-data";
import type { Backend, CarFilters } from "../lib/types";

export default function FilterBar({ backend, filters }: { backend: Backend; filters: CarFilters }) {
  const router = useRouter();
  const [f, setF] = useState(filters);
  const [featOpen, setFeatOpen] = useState(false);
  const featRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!featOpen) return;
    function onDown(e: MouseEvent) {
      if (featRef.current && !featRef.current.contains(e.target as Node)) setFeatOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [featOpen]);

  function set<K extends keyof CarFilters>(k: K, v: CarFilters[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function apply() {
    const p = new URLSearchParams();
    p.set("backend", backend);
    if (f.brand) p.set("brand", f.brand);
    if (f.bodyType) p.set("bodyType", f.bodyType);
    if (f.fuelType) p.set("fuelType", f.fuelType);
    if (f.minHorsepower) p.set("minHorsepower", String(f.minHorsepower));
    if (f.maxPrice) p.set("maxPrice", String(f.maxPrice));
    for (const feat of f.features) p.append("feature", feat);
    p.set("sort", f.sort);
    router.push(`/?${p.toString()}`);
  }

  function reset() {
    router.push(`/?backend=${backend}`);
  }

  return (
    <aside className="panel" aria-label="Filters">
      <h2>Filters</h2>

      <div className="field">
        <label>Brand</label>
        <select value={f.brand ?? ""} onChange={(e) => set("brand", e.target.value || undefined)}>
          <option value="">Any</option>
          {BRAND_LIST.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Body type</label>
        <select value={f.bodyType ?? ""} onChange={(e) => set("bodyType", e.target.value || undefined)}>
          <option value="">Any</option>
          {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Fuel type</label>
        <select value={f.fuelType ?? ""} onChange={(e) => set("fuelType", e.target.value || undefined)}>
          <option value="">Any</option>
          {FUEL_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Min horsepower</label>
        <input type="number" min={0} step={10} value={f.minHorsepower ?? ""}
          onChange={(e) => set("minHorsepower", e.target.value ? Number(e.target.value) : undefined)} />
      </div>

      <div className="field">
        <label>Max price ($)</label>
        <input type="number" min={0} step={1000} value={f.maxPrice ?? ""}
          onChange={(e) => set("maxPrice", e.target.value ? Number(e.target.value) : undefined)} />
      </div>

      <div className="field">
        <label>
          Features — “deep” specs 🔬
          {f.features.length > 0 && <span className="count-badge">{f.features.length}</span>}
        </label>
        <div className="dropdown" ref={featRef}>
          <button type="button" className="dropdown-trigger" onClick={() => setFeatOpen((o) => !o)}>
            <span className={f.features.length ? "" : "muted"}>
              {f.features.length === 0
                ? "Any feature"
                : f.features.length <= 2
                ? f.features.join(", ")
                : `${f.features.length} selected`}
            </span>
            <span className="chev">▾</span>
          </button>
          {featOpen && (
            <div className="dropdown-panel">
              {f.features.length > 0 && (
                <button type="button" className="dropdown-clear" onClick={() => set("features", [])}>
                  Clear selection
                </button>
              )}
              <div className="checkbox-list">
                {FEATURE_POOL.map((feat) => {
                  const checked = f.features.includes(feat);
                  return (
                    <label key={feat} className={`check ${checked ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          set(
                            "features",
                            e.target.checked
                              ? [...f.features, feat]
                              : f.features.filter((x) => x !== feat)
                          )
                        }
                      />
                      {feat}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="hint">Multiple features are AND-ed (car must have all).</div>
      </div>

      <div className="field">
        <label>Sort</label>
        <select value={f.sort} onChange={(e) => set("sort", e.target.value as CarFilters["sort"])}>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
          <option value="hp_desc">Horsepower: high → low</option>
        </select>
      </div>

      <button className="btn" onClick={apply}>Apply filters</button>
      <button className="btn secondary" onClick={reset}>Reset</button>
    </aside>
  );
}

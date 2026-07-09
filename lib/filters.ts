import type { Backend, CarFilters } from "./types";

type SP = Record<string, string | string[] | undefined>;

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length ? s : undefined;
}
function num(sp: SP, k: string): number | undefined {
  const s = str(sp, k);
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function strAll(sp: SP, k: string): string[] {
  const v = sp[k];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((s): s is string => !!s && s.length > 0);
}

export function parseBackend(sp: SP): Backend {
  return str(sp, "backend") === "storage" ? "storage" : "db";
}

export function parseFilters(sp: SP): CarFilters {
  const sort = str(sp, "sort");
  return {
    brand: str(sp, "brand"),
    bodyType: str(sp, "bodyType"),
    fuelType: str(sp, "fuelType"),
    minHorsepower: num(sp, "minHorsepower"),
    maxPrice: num(sp, "maxPrice"),
    features: strAll(sp, "feature"),
    sort: sort === "price_desc" ? "price_desc" : sort === "hp_desc" ? "hp_desc" : "price_asc",
    page: Math.max(1, num(sp, "page") ?? 1),
  };
}

// Shared domain types for the cars demo.

export type Backend = "db" | "storage";

/** The full car spec document — stored as jsonb (Database backend) or as a
 *  JSON file in the bucket (Storage backend). Big on purpose, to trigger TOAST. */
export interface CarDetails {
  brand: string;
  model: string;
  year: number;
  trim: string;
  price: number;
  body_type: string;
  exterior_color: string;
  interior_color: string;
  fuel_type: string;
  transmission: string;
  drivetrain: string;
  doors: number;
  seats: number;
  engine: {
    type: string;
    displacement_l: number;
    cylinders: number;
    horsepower: number;
    torque_nm: number;
    aspiration: string;
  };
  performance: {
    top_speed_mph: number;
    zero_to_sixty_s: number;
    quarter_mile_s: number;
  };
  dimensions: {
    length_mm: number;
    width_mm: number;
    height_mm: number;
    wheelbase_mm: number;
    curb_weight_kg: number;
    cargo_l: number;
    fuel_tank_l: number;
  };
  fuel_economy: {
    city_mpg: number;
    highway_mpg: number;
    combined_mpg: number;
  };
  warranty: {
    basic_years: number;
    powertrain_years: number;
    roadside_years: number;
  };
  safety: {
    ncap_stars: number;
    airbags: number;
    features: string[];
  };
  features: string[];
  options: { code: string; name: string; price: number }[];
  available_colors: { name: string; hex: string; price: number }[];
  dealer_stock: { vin: string; dealer_code: string; status: string }[];
  description: string;
}

/** The subset of fields promoted to real columns in the Storage backend. */
export interface CarRow {
  id: number;
  name: string;
  brand: string;
  model: string;
  year: number;
  trim: string;
  price: number;
  body_type: string;
  exterior_color: string;
  fuel_type: string;
  transmission: string;
  drivetrain: string;
  seats: number;
  horsepower: number;
}

export interface CarFilters {
  brand?: string;
  bodyType?: string;
  fuelType?: string;
  minHorsepower?: number;
  maxPrice?: number;
  /** "Deep" specs that only live in the full document (features array).
   *  Multiple selected features are AND-ed: a car must have all of them. */
  features: string[];
  sort: "price_asc" | "price_desc" | "hp_desc";
  page: number;
}

export interface QueryResult {
  rows: CarRow[];
  total: number;
  /** server-side query time in milliseconds */
  ms: number;
  /** human-readable description of what ran (SQL / storage calls) */
  explain: string;
  /** true if the chosen backend cannot answer this filter natively */
  unsupported?: boolean;
}

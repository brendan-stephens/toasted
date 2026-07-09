// Generates realistic (fake) car spec documents big enough to trigger TOAST.
import type { CarDetails, CarRow } from "./types";

export const PAGE_SIZE = 24;

// A tiny seeded PRNG so seeding is reproducible run to run.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDS: Record<string, string[]> = {
  Toyota: ["Corolla", "Camry", "RAV4", "Highlander", "Supra", "Land Cruiser"],
  Honda: ["Civic", "Accord", "CR-V", "Pilot", "HR-V"],
  Ford: ["Focus", "Mustang", "Explorer", "F-150", "Bronco", "Escape"],
  BMW: ["3 Series", "5 Series", "X3", "X5", "M4", "i4"],
  Tesla: ["Model 3", "Model Y", "Model S", "Model X"],
  Audi: ["A4", "A6", "Q5", "Q7", "e-tron", "RS6"],
  Porsche: ["911", "Cayenne", "Macan", "Taycan", "Panamera"],
  Subaru: ["Impreza", "Outback", "Forester", "WRX", "BRZ"],
  Kia: ["Rio", "Sportage", "Sorento", "EV6", "Stinger"],
  Volkswagen: ["Golf", "Passat", "Tiguan", "ID.4", "Arteon"],
};

export const BRAND_LIST = Object.keys(BRANDS);
export const BODY_TYPES = ["Sedan", "SUV", "Hatchback", "Coupe", "Truck", "Wagon"];
export const FUEL_TYPES = ["Petrol", "Diesel", "Hybrid", "Electric"];
const TRANSMISSIONS = ["6-speed manual", "8-speed automatic", "CVT", "Single-speed"];
const DRIVETRAINS = ["FWD", "RWD", "AWD"];
const TRIMS = ["Base", "S", "SE", "SEL", "Sport", "Limited", "Platinum", "GT"];
const EXT_COLORS = ["Alpine White", "Jet Black", "Nardo Grey", "Racing Red", "Ocean Blue", "British Green", "Silver Metallic", "Sunset Orange"];
const INT_COLORS = ["Black Leather", "Tan Leather", "Grey Cloth", "Red Alcantara", "Cream Nappa"];

// A big pool so each car's feature list is varied (less compressible -> TOAST).
export const FEATURE_POOL = [
  "Adaptive Cruise Control", "Lane Keep Assist", "Blind Spot Monitor", "360 Camera",
  "Heated Seats", "Ventilated Seats", "Massaging Seats", "Panoramic Sunroof",
  "Wireless Charging", "Apple CarPlay", "Android Auto", "Head-Up Display",
  "Ambient Lighting", "Premium Sound System", "Rear Cross Traffic Alert",
  "Automatic Emergency Braking", "Parking Sensors", "Self-Parking",
  "Keyless Entry", "Push Button Start", "Remote Start", "Power Tailgate",
  "Roof Rails", "Tow Package", "Adaptive Headlights", "Matrix LED Headlights",
  "Fog Lights", "Rain Sensing Wipers", "Heated Steering Wheel", "Dual Zone Climate",
  "Tri Zone Climate", "Navigation System", "Digital Instrument Cluster",
  "Wireless Apple CarPlay", "Bose Audio", "Harman Kardon Audio", "Burmester Audio",
  "Night Vision", "Traffic Sign Recognition", "Driver Attention Monitor",
  "Semi-Autonomous Driving", "Sport Suspension", "Air Suspension", "Adaptive Dampers",
  "Limited Slip Differential", "Launch Control", "Sport Exhaust", "Carbon Fiber Trim",
  "Aluminum Pedals", "Paddle Shifters", "Wireless Phone Mirroring", "Rear Entertainment",
  "Cooled Glovebox", "Power Folding Mirrors", "Auto Dimming Mirrors", "Soft Close Doors",
  "Hands-Free Tailgate", "Surround View", "Trailer Assist", "Off-Road Mode",
];

const OPTION_POOL = [
  ["TECH", "Technology Package", 2500],
  ["LUX", "Luxury Package", 4200],
  ["SPORT", "Sport Package", 3100],
  ["TOW", "Towing Package", 1200],
  ["WINTER", "Cold Weather Package", 900],
  ["PREM", "Premium Package", 5600],
  ["ADAS", "Driver Assist Package", 2800],
  ["AUDIO", "Premium Audio Upgrade", 1800],
  ["WHEELS", "21\" Alloy Wheels", 1500],
  ["PAINT", "Metallic Paint", 700],
  ["TINT", "Privacy Glass", 450],
  ["HITCH", "Trailer Hitch", 600],
] as const;

const COLOR_POOL = [
  ["Alpine White", "#f5f5f5", 0],
  ["Jet Black", "#0a0a0a", 0],
  ["Nardo Grey", "#6b6e70", 750],
  ["Racing Red", "#c8102e", 900],
  ["Ocean Blue", "#1b3a5b", 750],
  ["British Green", "#12472a", 900],
  ["Sunset Orange", "#e2571e", 1200],
] as const;

const SAFETY_POOL = [
  "Frontal Collision Warning", "Pedestrian Detection", "Cyclist Detection",
  "Automatic High Beams", "Emergency Lane Keeping", "Cross Traffic Braking",
  "Rear Occupant Alert", "Speed Limiter", "Tire Pressure Monitor",
];

const DESCRIPTION_FRAGMENTS = [
  "A refined balance of comfort and performance, engineered for the daily commute and the weekend escape alike.",
  "Precision handling meets everyday usability in a package that turns heads without shouting for attention.",
  "Built around a spacious, tech-forward cabin, it puts connectivity and safety at the center of every drive.",
  "Confident power delivery and a composed ride make long journeys feel effortless.",
  "Thoughtful storage, generous seating, and a suite of driver aids round out a genuinely practical companion.",
];

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickN<T>(rand: () => number, arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
}
function randInt(rand: () => number, min: number, max: number) {
  return min + Math.floor(rand() * (max - min + 1));
}
function vin(rand: () => number) {
  const chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 17; i++) s += chars[Math.floor(rand() * chars.length)];
  return s;
}

/** Deterministically build one car's full spec document from its id. */
export function buildCar(id: number): { name: string; details: CarDetails; row: Omit<CarRow, "id"> } {
  const rand = mulberry32(id * 2654435761);

  const brand = pick(rand, BRAND_LIST);
  const model = pick(rand, BRANDS[brand]);
  const year = randInt(rand, 2015, 2025);
  const trim = pick(rand, TRIMS);
  const body_type = pick(rand, BODY_TYPES);
  const fuel_type = pick(rand, FUEL_TYPES);
  const transmission = fuel_type === "Electric" ? "Single-speed" : pick(rand, TRANSMISSIONS);
  const drivetrain = pick(rand, DRIVETRAINS);
  const horsepower = randInt(rand, 90, 620);
  const price = Math.round(randInt(rand, 18000, 145000) / 100) * 100;
  const seats = pick(rand, [2, 4, 5, 5, 5, 7]);
  const exterior_color = pick(rand, EXT_COLORS);

  const details: CarDetails = {
    brand,
    model,
    year,
    trim,
    price,
    body_type,
    exterior_color,
    interior_color: pick(rand, INT_COLORS),
    fuel_type,
    transmission,
    drivetrain,
    doors: body_type === "Coupe" ? 2 : pick(rand, [4, 4, 5]),
    seats,
    engine: {
      type: fuel_type === "Electric" ? "Electric Motor" : `${randInt(rand, 3, 8)}-cylinder`,
      displacement_l: fuel_type === "Electric" ? 0 : Number((randInt(rand, 10, 60) / 10).toFixed(1)),
      cylinders: fuel_type === "Electric" ? 0 : pick(rand, [3, 4, 4, 6, 8]),
      horsepower,
      torque_nm: horsepower * randInt(rand, 12, 18) / 10 | 0,
      aspiration: pick(rand, ["Naturally Aspirated", "Turbocharged", "Twin-Turbo", "Supercharged"]),
    },
    performance: {
      top_speed_mph: randInt(rand, 90, 205),
      zero_to_sixty_s: Number((randInt(rand, 22, 120) / 10).toFixed(1)),
      quarter_mile_s: Number((randInt(rand, 110, 180) / 10).toFixed(1)),
    },
    dimensions: {
      length_mm: randInt(rand, 3800, 5300),
      width_mm: randInt(rand, 1700, 2100),
      height_mm: randInt(rand, 1350, 1850),
      wheelbase_mm: randInt(rand, 2400, 3100),
      curb_weight_kg: randInt(rand, 1100, 2600),
      cargo_l: randInt(rand, 250, 900),
      fuel_tank_l: fuel_type === "Electric" ? 0 : randInt(rand, 40, 90),
    },
    fuel_economy: {
      city_mpg: randInt(rand, 15, 58),
      highway_mpg: randInt(rand, 22, 72),
      combined_mpg: randInt(rand, 18, 64),
    },
    warranty: {
      basic_years: pick(rand, [3, 4, 5]),
      powertrain_years: pick(rand, [5, 6, 10]),
      roadside_years: pick(rand, [3, 5]),
    },
    safety: {
      ncap_stars: pick(rand, [3, 4, 5, 5]),
      airbags: pick(rand, [6, 7, 8, 9, 10]),
      features: pickN(rand, SAFETY_POOL, randInt(rand, 4, 8)),
    },
    // Wide, varied arrays are what push the document over the TOAST threshold.
    features: pickN(rand, FEATURE_POOL, randInt(rand, 22, 46)),
    options: pickN(rand, OPTION_POOL, randInt(rand, 5, 10)).map(([code, name, base]) => ({
      code,
      name,
      price: (base as number) + randInt(rand, 0, 400),
    })),
    available_colors: pickN(rand, COLOR_POOL, randInt(rand, 4, 7)).map(([name, hex, p]) => ({
      name: name as string,
      hex: hex as string,
      price: p as number,
    })),
    dealer_stock: Array.from({ length: randInt(rand, 6, 14) }, () => ({
      vin: vin(rand),
      dealer_code: `D${randInt(rand, 1000, 9999)}`,
      status: pick(rand, ["in_stock", "in_transit", "reserved", "sold"]),
    })),
    description: pickN(rand, DESCRIPTION_FRAGMENTS, 2).join(" "),
  };

  const name = `${year} ${brand} ${model} ${trim}`;
  return {
    name,
    details,
    row: {
      name,
      brand,
      model,
      year,
      trim,
      price,
      body_type,
      exterior_color,
      fuel_type,
      transmission,
      drivetrain,
      seats,
      horsepower,
    },
  };
}

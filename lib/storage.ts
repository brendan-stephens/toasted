import "server-only";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const bucket = process.env.CAR_DETAILS_BUCKET ?? "car-details";
if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");

/** Public URL for a car's spec file in the Storage bucket. */
export function detailsPublicUrl(path: string): string {
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}

/** Fetch and parse a car's full spec document from Storage. */
export async function fetchDetailsFromStorage(path: string): Promise<unknown> {
  const res = await fetch(detailsPublicUrl(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`storage fetch failed: ${res.status} ${path}`);
  return res.json();
}

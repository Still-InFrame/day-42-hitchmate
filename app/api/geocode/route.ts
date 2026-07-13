import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Server-side reverse geocoding (coords -> address + coarse area label) via the
// Google Geocoding API. Uses the secret server key (never the browser). Returns
// a full formatted address (shown to the rider to confirm, and to the matched
// driver) plus a coarse label (neighborhood/locality) safe to show publicly.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Prefer a dedicated secret server key; fall back to the shared Maps key
  // (which also has Geocoding enabled).
  const key =
    process.env.GOOGLE_ROUTES_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "geocode_unavailable" }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { lat, lng } = (body ?? {}) as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return NextResponse.json({ error: "geocode_failed" }, { status: 502 });
  const data = await res.json();
  const result = data.results?.[0];
  if (!result) return NextResponse.json({ error: "no_result" }, { status: 404 });

  // Coarse label: prefer neighborhood, then sublocality, then locality — never
  // the street/house number, so the public pin stays fuzzed.
  const components: { long_name: string; types: string[] }[] =
    result.address_components ?? [];
  const pick = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name;
  const label =
    pick("neighborhood") ??
    pick("sublocality") ??
    pick("locality") ??
    pick("administrative_area_level_2") ??
    null;

  return NextResponse.json({
    formattedAddress: result.formatted_address as string,
    label,
  });
}

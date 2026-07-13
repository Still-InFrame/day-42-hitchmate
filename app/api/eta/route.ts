import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Server-side driving ETA via Google Routes API. The key is read from a
// non-public env var and never reaches the browser (this is the "secret,
// server-only" key, separate from the public map key). Auth-gated so it can't
// be used as an open proxy that burns the Routes quota.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Prefer a dedicated secret server key; fall back to the shared Maps key
  // (which also has Routes enabled). Both are readable server-side.
  const key =
    process.env.GOOGLE_ROUTES_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    // Not configured — the client falls back to straight-line distance.
    return NextResponse.json({ error: "eta_unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { originLat, originLng, destLat, destLng } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    [originLat, originLng, destLat, destLng].some((v) => typeof v !== "number")
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    },
  );

  if (!res.ok) {
    return NextResponse.json({ error: "routes_failed" }, { status: 502 });
  }
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) {
    return NextResponse.json({ error: "no_route" }, { status: 404 });
  }
  const durationSeconds = parseInt(String(route.duration).replace("s", ""), 10);
  return NextResponse.json({
    durationSeconds,
    distanceMeters: route.distanceMeters ?? null,
  });
}

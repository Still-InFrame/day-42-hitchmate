"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  APIProvider,
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { metersToMiles } from "@/lib/geo";
import type { Ride } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
type LatLng = { lat: number; lng: number };

// Draws the actual journey as a blue polyline and frames the whole route.
function TrackLine({ points }: { points: LatLng[] }) {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  useEffect(() => {
    if (!map || !maps || points.length < 1) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    let line: google.maps.Polyline | null = null;
    if (points.length >= 2) {
      line = new maps.Polyline({
        path: points,
        strokeColor: "#3b82f6",
        strokeOpacity: 0.95,
        strokeWeight: 5,
      });
      line.setMap(map);
    }
    map.fitBounds(bounds, 64);
    return () => line?.setMap(null);
  }, [map, maps, points]);
  return null;
}

export default function JourneyMap({
  ride,
  start,
  track,
  viewerIsRider,
}: {
  ride: Ride;
  start: LatLng | null;
  track: LatLng[];
  viewerIsRider: boolean;
}) {
  const router = useRouter();
  const [endLabel, setEndLabel] = useState<string | null>(null);

  const end =
    ride.end_lat != null && ride.end_lng != null
      ? { lat: ride.end_lat, lng: ride.end_lng }
      : null;
  const points: LatLng[] = [];
  if (start) points.push(start);
  points.push(...track);
  if (end) points.push(end);

  const miles = ride.distance_meters != null ? metersToMiles(ride.distance_meters) : null;
  const started = ride.started_at ? new Date(ride.started_at) : null;
  const ended = ride.ended_at ? new Date(ride.ended_at) : null;
  const durationMin =
    started && ended
      ? Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000))
      : null;

  useEffect(() => {
    if (!end) return;
    fetch("/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: end.lat, lng: end.lng }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEndLabel(d?.formattedAddress ?? d?.crossStreets ?? null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end?.lat, end?.lng]);

  const fmtTime = (d: Date | null) =>
    d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
  const fmtDate = ended
    ? ended.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "";

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative h-[46vh] w-full shrink-0">
        {KEY && points.length ? (
          <APIProvider apiKey={KEY}>
            <Map
              defaultCenter={points[0]}
              defaultZoom={14}
              gestureHandling="greedy"
              disableDefaultUI
              clickableIcons={false}
              className="absolute inset-0"
            >
              {start && <Marker position={start} label={{ text: "🟢", fontSize: "16px" }} />}
              {end && <Marker position={end} label={{ text: "🏁", fontSize: "16px" }} />}
              <TrackLine points={points} />
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center bg-surface text-sm text-muted">
            No route was recorded for this ride.
          </div>
        )}
        <button
          onClick={() => router.push("/history")}
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
          className="absolute left-4 z-10 flex items-center gap-1 rounded-full bg-surface/90 px-4 py-2 text-sm font-medium backdrop-blur"
        >
          ← History
        </button>
      </div>

      <div className="mx-auto w-full max-w-md px-6 pt-5 pb-safe">
        <p className="text-xs uppercase tracking-wide text-muted">
          {fmtDate} · {viewerIsRider ? "as rider" : "as driver"}
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          {miles != null ? `${miles.toFixed(1)} miles` : "Trip"}
        </h1>

        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <span className="text-sm text-muted">Picked up</span>
            <span className="text-sm font-medium">{fmtTime(started)}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <span className="text-sm text-muted">Dropped off</span>
            <span className="text-sm font-medium">
              {fmtTime(ended)}
              {durationMin != null ? ` · ${durationMin} min` : ""}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-sm text-muted">Start</p>
            <p className="text-sm font-medium">🟢 {ride.approx_label ?? "Pickup area"}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-sm text-muted">Actual drop-off</p>
            <p className="text-sm font-medium">🏁 {endLabel ?? "—"}</p>
            {ride.destination_note && (
              <p className="mt-1 text-xs text-muted">Planned: {ride.destination_note}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

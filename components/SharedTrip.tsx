"use client";

import { useCallback, useEffect, useState } from "react";
import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";
import { createClient } from "@/lib/supabase/client";
import { tripChannel } from "@/lib/rideEvents";
import type { RideStatus } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

interface Trip {
  status: RideStatus;
  rider_name: string | null;
  driver_name: string | null;
  driver_photo: string | null;
  vehicle: string | null;
  plate: string | null;
  rider_lat: number | null;
  rider_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  destination_note: string | null;
  created_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

export default function SharedTrip({ token }: { token: string }) {
  const supabase = createClient();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("hitchmate_shared_trip", {
      p_token: token,
    });
    const row = (data as Trip[] | null)?.[0];
    if (error || !row) {
      setState((s) => (s === "ok" ? "ok" : "notfound"));
      return;
    }
    setTrip(row);
    setState("ok");
  }, [supabase, token]);

  // Instant refresh on stage changes (broadcast), plus a short poll for live
  // driver movement (public page can't use RLS realtime for row data).
  useEffect(() => {
    load();
    const ch = supabase
      .channel(tripChannel(token), { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "update" }, () => load())
      .subscribe();
    const poll = setInterval(load, 4000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
    };
  }, [supabase, token, load]);

  if (state === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center pt-safe pb-safe">
        <p className="animate-pulse text-muted">Loading trip…</p>
      </main>
    );
  }

  if (state === "notfound" || !trip) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center pt-safe pb-safe">
        <span className="text-4xl">🔗</span>
        <h1 className="text-xl font-bold">Trip link not available</h1>
        <p className="text-sm text-muted">This link is invalid, or the trip has ended.</p>
      </main>
    );
  }

  if (trip.status === "completed" || trip.status === "cancelled") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center pt-safe pb-safe">
        <span className="text-4xl">{trip.status === "completed" ? "✅" : "🚫"}</span>
        <h1 className="text-xl font-bold">
          {trip.status === "completed" ? "Trip complete" : "Trip ended"}
        </h1>
        <p className="text-sm text-muted">
          {trip.rider_name ?? "Your friend"}&apos;s ride has ended.
        </p>
      </main>
    );
  }

  const riderPos =
    trip.rider_lat != null && trip.rider_lng != null
      ? { lat: trip.rider_lat, lng: trip.rider_lng }
      : null;
  const driverPos =
    trip.driver_lat != null && trip.driver_lng != null
      ? { lat: trip.driver_lat, lng: trip.driver_lng }
      : null;
  const driverFirst = trip.driver_name?.split(" ")[0] ?? "The driver";

  const headline =
    trip.status === "open"
      ? "Waiting for a driver…"
      : trip.status === "in_progress"
        ? "On the trip 🚗"
        : `${driverFirst} is on the way`;

  // Stage progress is driven by the current status; timestamps are shown when
  // available (older rides may be missing some).
  const stages: { label: string; at: string | null; reached: boolean }[] = [
    { label: "Requested a ride", at: trip.created_at, reached: true },
    {
      label: `${driverFirst} accepted`,
      at: trip.accepted_at,
      reached: ["accepted", "in_progress", "completed"].includes(trip.status),
    },
    {
      label: "Picked up",
      at: trip.started_at,
      reached: ["in_progress", "completed"].includes(trip.status),
    },
    // Completed rides render the "Trip complete" screen above, so on the live
    // timeline this final stage is always still pending.
    { label: "Dropped off", at: trip.ended_at, reached: false },
  ];

  return (
    <main className="flex flex-1 flex-col pb-safe">
      <div className="relative h-[42vh] w-full shrink-0">
        {KEY && (riderPos || driverPos) ? (
          <APIProvider apiKey={KEY}>
            <Map
              defaultCenter={riderPos ?? driverPos ?? undefined}
              defaultZoom={15}
              gestureHandling="greedy"
              disableDefaultUI
              clickableIcons={false}
              className="absolute inset-0"
            >
              {riderPos && <Marker position={riderPos} label={{ text: "🧍", fontSize: "18px" }} />}
              {driverPos && <Marker position={driverPos} label={{ text: "🚗", fontSize: "18px" }} />}
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center bg-surface text-sm text-muted">
            Waiting for location…
          </div>
        )}
        <div className="pt-safe absolute inset-x-0 top-0 flex justify-center">
          <div className="mt-3 flex items-center gap-2 rounded-full bg-surface/90 px-4 py-2 backdrop-blur">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={20} height={20} className="rounded" />
            <span className="text-sm font-semibold">HitchMate · shared trip</span>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-6 pt-6">
        <h1 className="text-xl font-bold">
          Following {trip.rider_name ?? "a rider"}&apos;s trip
        </h1>
        {trip.destination_note && (
          <p className="mt-1 text-sm text-muted">Heading: {trip.destination_note}</p>
        )}

        {trip.status === "open" ? (
          <p className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
            {headline} — you&apos;ll see the driver and their live location here
            once matched.
          </p>
        ) : (
          <div className="mt-6 flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
            <div className="h-14 w-14 overflow-hidden rounded-xl bg-surface-2">
              {trip.driver_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={trip.driver_photo} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div>
              <p className="font-semibold">{headline}</p>
              <p className="text-sm text-muted">
                {trip.driver_name ?? "Driver"} · {trip.vehicle ?? "Vehicle"}
                {trip.plate ? ` · ${trip.plate}` : ""}
              </p>
            </div>
          </div>
        )}

        {/* Timestamped stage timeline */}
        <ol className="mt-6">
          {stages.map((s, i) => {
            const reached = s.reached;
            const last = i === stages.length - 1;
            return (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
                      reached ? "bg-accent" : "border border-border bg-surface-2"
                    }`}
                  />
                  {!last && (
                    <span
                      className={`w-px flex-1 ${reached ? "bg-accent/50" : "bg-border"}`}
                    />
                  )}
                </div>
                <div className={last ? "pb-0" : "pb-5"}>
                  <p className={`text-sm ${reached ? "font-medium" : "text-muted"}`}>
                    {s.label}
                  </p>
                  {s.at && <p className="text-xs text-muted">{fmtTime(s.at)}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 pb-6 text-center text-xs text-muted">
          Shared via HitchMate for safety. Updates live until drop-off.
        </p>
      </div>
    </main>
  );
}

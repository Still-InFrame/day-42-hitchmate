"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { haversineMeters, formatDistance } from "@/lib/geo";
import type { Ride, RideLocation, Profile, Message } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const ARRIVAL_M = 300;

export default function RideRoom({
  userId,
  initialRide,
  initialLoc,
  rider,
  driver,
}: {
  userId: string;
  initialRide: Ride;
  initialLoc: RideLocation | null;
  rider: Profile | null;
  driver: Profile | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [ride, setRide] = useState(initialRide);
  const [loc, setLoc] = useState<RideLocation | null>(initialLoc);
  const [driverProfile, setDriverProfile] = useState<Profile | null>(driver);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [eta, setEta] = useState<{ durationSeconds: number; distanceMeters: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEtaRef = useRef(0);

  const isRider = ride.rider_id === userId;
  const isDriver = ride.driver_id === userId;
  const other = isRider ? driverProfile : rider;

  // Derived positions (from the private location row).
  const riderPos = loc ? { lat: loc.exact_lat, lng: loc.exact_lng } : null;
  const driverPos =
    loc?.driver_lat != null && loc?.driver_lng != null
      ? { lat: loc.driver_lat, lng: loc.driver_lng }
      : null;

  // Initial message history.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("hitchmate_messages")
        .select("*")
        .eq("ride_id", ride.id)
        .order("created_at", { ascending: true })
        .returns<Message[]>();
      setMessages(data ?? []);
    })();
  }, [supabase, ride.id]);

  // Fetch the driver profile once a driver accepts (rider didn't have it yet).
  useEffect(() => {
    if (ride.driver_id && !driverProfile) {
      supabase
        .from("hitchmate_profiles")
        .select("*")
        .eq("id", ride.driver_id)
        .maybeSingle<Profile>()
        .then(({ data }) => data && setDriverProfile(data));
    }
  }, [ride.driver_id, driverProfile, supabase]);

  // Realtime: ride status, driver location, and chat.
  useEffect(() => {
    const ch = supabase
      .channel(`ride:${ride.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "hitchmate_rides", filter: `id=eq.${ride.id}` },
        (p: RealtimePostgresChangesPayload<Ride>) => setRide(p.new as Ride),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "hitchmate_ride_locations", filter: `ride_id=eq.${ride.id}` },
        (p: RealtimePostgresChangesPayload<RideLocation>) => setLoc(p.new as RideLocation),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "hitchmate_messages", filter: `ride_id=eq.${ride.id}` },
        (p: RealtimePostgresChangesPayload<Message>) => setMessages((m) => [...m, p.new as Message]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, ride.id]);

  // Keep chat scrolled to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Driver publishes their live position while the ride is active.
  useEffect(() => {
    if (!isDriver || ride.status !== "accepted" || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - last < 4000) return;
        last = now;
        supabase
          .from("hitchmate_ride_locations")
          .update({
            driver_lat: pos.coords.latitude,
            driver_lng: pos.coords.longitude,
            driver_updated_at: new Date().toISOString(),
          })
          .eq("ride_id", ride.id);
      },
      () => {},
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [isDriver, ride.status, ride.id, supabase]);

  // Rider polls a real driving ETA from our server route as the driver moves,
  // throttled to control cost. Falls back to straight-line if unavailable.
  useEffect(() => {
    if (!isRider || !riderPos || !driverPos || ride.status !== "accepted") return;
    const now = Date.now();
    if (now - lastEtaRef.current < 20000) return;
    lastEtaRef.current = now;
    fetch("/api/eta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originLat: driverPos.lat,
        originLng: driverPos.lng,
        destLat: riderPos.lat,
        destLng: riderPos.lng,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.durationSeconds != null && setEta(d))
      .catch(() => {});
  }, [isRider, ride.status, riderPos?.lat, riderPos?.lng, driverPos?.lat, driverPos?.lng]);

  const send = useCallback(async () => {
    const body = input.trim();
    if (!body) return;
    setInput("");
    await supabase
      .from("hitchmate_messages")
      .insert({ ride_id: ride.id, sender_id: userId, body });
  }, [input, supabase, ride.id, userId]);

  async function setStatus(status: "completed" | "cancelled") {
    await supabase.from("hitchmate_rides").update({ status }).eq("id", ride.id);
    router.replace("/map");
  }

  function report() {
    if (
      confirm(
        "Report this person and end the ride? They will no longer see your location.",
      )
    ) {
      setStatus("cancelled");
    }
  }

  async function shareTrip() {
    const url = `${window.location.origin}/trip/${ride.share_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; ignore */
    }
  }

  // ----- Ended state -----
  if (ride.status === "completed" || ride.status === "cancelled") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center pt-safe pb-safe">
        <span className="text-4xl">{ride.status === "completed" ? "✅" : "🚫"}</span>
        <h1 className="text-xl font-bold">
          {ride.status === "completed" ? "Ride complete" : "Ride ended"}
        </h1>
        <button
          onClick={() => router.replace("/map")}
          className="btn-accent rounded-xl px-6 py-3"
        >
          Back to map
        </button>
      </main>
    );
  }

  // ----- Rider waiting for a driver -----
  if (ride.status === "open") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center pt-safe pb-safe">
        <div className="h-14 w-14 animate-pulse rounded-full bg-accent/20 text-3xl leading-[3.5rem]">
          📍
        </div>
        <div>
          <h1 className="text-xl font-bold">Looking for a driver…</h1>
          <p className="mt-2 text-sm text-muted">
            Nearby drivers can see your approximate area. You&apos;ll get their
            details the moment someone accepts.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button onClick={shareTrip} className="text-sm font-medium text-accent">
            {copied ? "Link copied!" : "🔗 Share my trip with a friend"}
          </button>
          <button
            onClick={() => setStatus("cancelled")}
            className="rounded-xl border border-border px-6 py-3 text-sm"
          >
            Cancel request
          </button>
        </div>
      </main>
    );
  }

  // ----- Matched: live map + chat -----
  const distance =
    riderPos && driverPos ? haversineMeters(riderPos, driverPos) : null;
  const arriving = distance != null && distance <= ARRIVAL_M;
  const etaMin = eta ? Math.max(1, Math.round(eta.durationSeconds / 60)) : null;
  // Driver's deep-link to native turn-by-turn navigation to the exact pickup.
  const navUrl = riderPos
    ? `https://www.google.com/maps/dir/?api=1&destination=${riderPos.lat},${riderPos.lng}&travelmode=driving`
    : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* Map */}
      <div className="relative h-[38vh] w-full shrink-0">
        {KEY && riderPos ? (
          <APIProvider apiKey={KEY}>
            <Map
              defaultCenter={riderPos}
              defaultZoom={15}
              gestureHandling="greedy"
              disableDefaultUI
              clickableIcons={false}
              className="absolute inset-0"
            >
              <Marker position={riderPos} />
              {driverPos && (
                <Marker position={driverPos} label={{ text: "🚗", fontSize: "20px" }} />
              )}
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-full items-center justify-center bg-surface text-sm text-muted">
            Map unavailable
          </div>
        )}

        <button
          onClick={() => router.replace("/map")}
          className="pt-safe absolute left-4 top-0 mt-2 rounded-full bg-surface/90 px-3 py-1.5 text-xs backdrop-blur"
        >
          ← Map
        </button>
      </div>

      {/* Arrival / status card */}
      {other && (
        <div
          className={`mx-4 mt-3 shrink-0 rounded-2xl border p-4 ${
            arriving ? "border-accent bg-surface-2" : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-xl bg-surface-2">
              {other.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={other.photo_url} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex-1">
              <p className="font-semibold">{other.display_name ?? "User"}</p>
              {isRider ? (
                <p className="text-xs text-muted">
                  {driverProfile?.vehicle_color} {driverProfile?.vehicle_make_model}
                  {driverProfile?.vehicle_plate ? ` · ${driverProfile.vehicle_plate}` : ""}
                </p>
              ) : (
                <p className="text-xs text-muted">Your rider</p>
              )}
            </div>
            {distance != null && (
              <div className="text-right">
                <p className={`text-sm font-semibold ${arriving ? "text-accent" : ""}`}>
                  {etaMin != null ? `${etaMin} min` : formatDistance(distance)}
                </p>
                <p className="text-[10px] text-muted">
                  {etaMin != null ? `· ${formatDistance(distance)}` : "away"}
                </p>
              </div>
            )}
          </div>

          {/* Driver: hand off to native turn-by-turn navigation. */}
          {isDriver && navUrl && (
            <a
              href={navUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-accent mt-3 flex h-12 items-center justify-center gap-2 rounded-xl"
            >
              🧭 Navigate to pickup
            </a>
          )}
          {isRider && arriving && (
            <p className="mt-3 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent">
              {driverProfile?.display_name?.split(" ")[0] ?? "Your driver"} is arriving —
              look for {driverProfile?.vehicle_color ? `a ${driverProfile.vehicle_color} ` : "the "}
              {driverProfile?.vehicle_make_model ?? "vehicle"}
              {driverProfile?.vehicle_plate ? `, plate ${driverProfile.vehicle_plate}` : ""}.
            </p>
          )}
        </div>
      )}

      {/* Chat */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-2xl">💬</span>
            <p className="text-sm text-muted">Say hi and coordinate your pickup.</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                    mine ? "bg-accent text-accent-fg" : "bg-surface-2"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer + actions */}
      <div className="pb-safe border-t border-border bg-surface px-4 pt-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message…"
            className="flex-1 rounded-full border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
          />
          <button
            onClick={send}
            className="btn-accent flex h-12 w-12 items-center justify-center rounded-full text-lg"
          >
            ↑
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <button onClick={report} className="text-xs text-danger">
            Report / block
          </button>
          {isRider && (
            <button onClick={shareTrip} className="text-xs font-medium text-accent">
              {copied ? "Link copied!" : "🔗 Share trip"}
            </button>
          )}
          <button
            onClick={() => setStatus("completed")}
            className="text-xs font-medium text-success"
          >
            {isDriver ? "Picked up — complete" : "I've been picked up"}
          </button>
        </div>
      </div>
    </div>
  );
}

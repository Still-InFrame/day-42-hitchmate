"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APIProvider, Map, Marker } from "@vis.gl/react-google-maps";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { haversineMeters, formatDistance, metersToMiles } from "@/lib/geo";
import { announceRideGone } from "@/lib/rideEvents";
import { playAccepted, playEnded, armSound } from "@/lib/sound";
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
  const [otherTyping, setOtherTyping] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [rated, setRated] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEtaRef = useRef(0);
  const prevStatusRef = useRef(ride.status);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const otherTypingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Realtime: ride status, driver location, chat, and ephemeral typing.
  useEffect(() => {
    const ch = supabase
      .channel(`ride:${ride.id}`, { config: { broadcast: { self: false } } })
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
      .on(
        "broadcast",
        { event: "typing" },
        (msg: { payload: { from: string; typing: boolean } }) => {
          if (msg.payload.from === userId) return;
          setOtherTyping(msg.payload.typing);
          if (otherTypingClearRef.current) clearTimeout(otherTypingClearRef.current);
          // Auto-clear in case the "stopped typing" event is missed.
          if (msg.payload.typing) {
            otherTypingClearRef.current = setTimeout(() => setOtherTyping(false), 4000);
          }
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [supabase, ride.id, userId]);

  // Keep chat scrolled to the newest message (and the typing bubble).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, otherTyping]);

  // Arm audio on first gesture; chime when a request is accepted or the ride ends.
  useEffect(() => armSound(), []);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur = ride.status;
    if (prev === cur) return;
    prevStatusRef.current = cur;
    if (prev === "open" && cur === "accepted") playAccepted();
    if (
      (cur === "completed" || cur === "cancelled") &&
      prev !== "completed" &&
      prev !== "cancelled"
    ) {
      playEnded();
    }
  }, [ride.status]);

  // Driver publishes live position while active, and records the journey path
  // (track points) once the ride is in progress.
  useEffect(() => {
    const active = ride.status === "accepted" || ride.status === "in_progress";
    if (!isDriver || !active || !navigator.geolocation) return;
    let lastPub = 0;
    let lastTrack = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (now - lastPub >= 4000) {
          lastPub = now;
          supabase
            .from("hitchmate_ride_locations")
            .update({ driver_lat: lat, driver_lng: lng, driver_updated_at: new Date().toISOString() })
            .eq("ride_id", ride.id);
        }
        if (ride.status === "in_progress" && now - lastTrack >= 8000) {
          lastTrack = now;
          supabase.from("hitchmate_ride_track").insert({ ride_id: ride.id, lat, lng });
        }
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

  function broadcastTyping(typing: boolean) {
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { from: userId, typing },
    });
  }

  // Broadcast "typing" on first keystroke, then "stopped" after a short idle.
  function handleInput(v: string) {
    setInput(v);
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      broadcastTyping(true);
    }
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => {
      typingActiveRef.current = false;
      broadcastTyping(false);
    }, 1500);
  }

  const send = useCallback(async () => {
    const body = input.trim();
    if (!body) return;
    setInput("");
    typingActiveRef.current = false;
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { from: userId, typing: false },
    });
    await supabase
      .from("hitchmate_messages")
      .insert({ ride_id: ride.id, sender_id: userId, body });
  }, [input, supabase, ride.id, userId]);

  // Either party marks the pickup as happened — the ride is now underway.
  async function startRide() {
    setRide((r) => ({ ...r, status: "in_progress" })); // optimistic
    await supabase
      .from("hitchmate_rides")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", ride.id);
  }

  async function completeRide() {
    // Log the ACTUAL journey: distance + real drop-off from the recorded track
    // (the ending spot can differ from the pre-placed destination).
    const { data: track } = await supabase
      .from("hitchmate_ride_track")
      .select("lat, lng")
      .eq("ride_id", ride.id)
      .order("recorded_at", { ascending: true })
      .returns<{ lat: number; lng: number }[]>();
    let dist = 0;
    let endLat = loc?.driver_lat ?? null;
    let endLng = loc?.driver_lng ?? null;
    if (track && track.length > 1) {
      for (let i = 1; i < track.length; i++) {
        dist += haversineMeters(track[i - 1], track[i]);
      }
    }
    if (track && track.length) {
      endLat = track[track.length - 1].lat;
      endLng = track[track.length - 1].lng;
    }
    setRide((r) => ({ ...r, status: "completed" })); // reveal the rating screen
    await supabase
      .from("hitchmate_rides")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        end_lat: endLat,
        end_lng: endLng,
        distance_meters: dist || null,
      })
      .eq("id", ride.id);
  }

  async function submitRating() {
    const rateeId = isRider ? ride.driver_id : ride.rider_id;
    if (!rateeId || stars < 1) return;
    setRatingBusy(true);
    await supabase.from("hitchmate_ratings").insert({
      ride_id: ride.id,
      rater_id: userId,
      ratee_id: rateeId,
      stars,
      comment: ratingComment.trim() || null,
    });
    setRatingBusy(false);
    setRated(true);
  }

  async function confirmCancel() {
    if (!cancelReason.trim()) return;
    setCancelBusy(true);
    await supabase
      .from("hitchmate_rides")
      .update({
        status: "cancelled",
        cancel_reason: cancelReason.trim(),
        cancelled_by: userId,
      })
      .eq("id", ride.id);
    announceRideGone(supabase, ride.id); // drop the pin off browsing maps
    router.replace("/map");
  }

  async function report() {
    if (
      confirm(
        "Report this person and end the ride? They will no longer see your location.",
      )
    ) {
      setOptionsOpen(false);
      await supabase
        .from("hitchmate_rides")
        .update({
          status: "cancelled",
          cancel_reason: "Reported — safety concern",
          cancelled_by: userId,
        })
        .eq("id", ride.id);
      announceRideGone(supabase, ride.id);
      router.replace("/map");
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

  const CANCEL_REASONS = ["Found another ride", "Waited too long", "Plans changed", "Safety concern"];
  const cancelModal = cancelOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={() => !cancelBusy && setCancelOpen(false)}
    >
      <div
        className="pb-safe mx-auto w-full max-w-md rounded-t-3xl border-t border-border bg-surface px-6 pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">Cancel this trip?</h2>
        <p className="mt-1 text-sm text-muted">
          Please tell the other person why — a reason is required.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setCancelReason(r)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                cancelReason === r
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border text-muted"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="Add a reason…"
          rows={3}
          className="mt-3 w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={confirmCancel}
          disabled={!cancelReason.trim() || cancelBusy}
          className="mt-4 h-14 w-full rounded-2xl bg-danger font-semibold text-white disabled:opacity-50"
        >
          {cancelBusy ? "Cancelling…" : "Confirm cancellation"}
        </button>
        <button
          onClick={() => setCancelOpen(false)}
          disabled={cancelBusy}
          className="mt-2 w-full py-2 text-sm text-muted"
        >
          Never mind
        </button>
      </div>
    </div>
  ) : null;

  // ----- Cancelled -----
  if (ride.status === "cancelled") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center pt-safe pb-safe">
        <span className="text-4xl">🚫</span>
        <h1 className="text-xl font-bold">Ride ended</h1>
        <button
          onClick={() => router.replace("/map")}
          className="btn-accent rounded-xl px-6 py-3"
        >
          Back to map
        </button>
      </main>
    );
  }

  // ----- Completed: show trip summary + rate the other party -----
  if (ride.status === "completed") {
    const miles = ride.distance_meters != null ? metersToMiles(ride.distance_meters) : null;
    const otherName = (isRider ? driverProfile : rider)?.display_name ?? "your match";
    const otherRole = isRider ? "driver" : "rider";
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-8 pt-safe pb-safe">
        <div className="text-center">
          <span className="text-4xl">✅</span>
          <h1 className="text-xl font-bold">Ride complete</h1>
          {miles != null && (
            <p className="mt-1 text-sm text-muted">{miles.toFixed(1)} mi traveled</p>
          )}
        </div>

        {!rated ? (
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5">
            <p className="text-center text-sm">
              How was your trip with{" "}
              <span className="font-semibold">{otherName}</span>?
            </p>
            <div className="mt-3 flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setStars(n)}
                  className={`text-3xl ${n <= stars ? "text-accent" : "text-muted opacity-40"}`}
                  aria-label={`${n} stars`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder={`Add a note about your ${otherRole} (optional)`}
              rows={2}
              className="mt-3 w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={submitRating}
              disabled={stars < 1 || ratingBusy}
              className="btn-accent mt-3 h-12 w-full rounded-xl disabled:opacity-50"
            >
              {ratingBusy ? "Submitting…" : "Submit rating"}
            </button>
          </div>
        ) : (
          <p className="text-sm font-medium text-success">Thanks for your rating! ⭐</p>
        )}

        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => router.replace("/map")}
            className="btn-accent rounded-xl px-6 py-3"
          >
            Back to map
          </button>
          <button
            onClick={() => router.push("/history")}
            className="text-sm text-muted"
          >
            View ride history
          </button>
        </div>
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
            onClick={() => setCancelOpen(true)}
            className="rounded-xl border border-border px-6 py-3 text-sm"
          >
            Cancel request
          </button>
        </div>
        {cancelModal}
      </main>
    );
  }

  // ----- Matched: live map + chat -----
  const distance =
    riderPos && driverPos ? haversineMeters(riderPos, driverPos) : null;
  const arriving = distance != null && distance <= ARRIVAL_M;
  const etaMin = eta ? Math.max(1, Math.round(eta.durationSeconds / 60)) : null;
  // Driver's deep-links to native turn-by-turn navigation to the exact pickup.
  const gMapsUrl = riderPos
    ? `https://www.google.com/maps/dir/?api=1&destination=${riderPos.lat},${riderPos.lng}&travelmode=driving`
    : null;
  const aMapsUrl = riderPos
    ? `https://maps.apple.com/?daddr=${riderPos.lat},${riderPos.lng}&dirflg=d`
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
              <p className="font-semibold">
                {other.display_name ?? "User"}
                {other.rating_count > 0 && other.rating_avg != null && (
                  <span className="ml-2 text-xs font-normal text-accent">
                    ★ {other.rating_avg.toFixed(1)}
                  </span>
                )}
              </p>
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

          {/* Driver: hand off to native turn-by-turn navigation (choose app). */}
          {isDriver && ride.status === "accepted" && gMapsUrl && aMapsUrl && (
            <div className="relative mt-3">
              <button
                onClick={() => setNavOpen((o) => !o)}
                className="btn-accent flex h-12 w-full items-center justify-center gap-2 rounded-xl"
              >
                🧭 Navigate to pickup
              </button>
              {navOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                  <a
                    href={aMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setNavOpen(false)}
                    className="block px-4 py-3 text-sm hover:bg-surface-2"
                  >
                     Apple Maps
                  </a>
                  <a
                    href={gMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setNavOpen(false)}
                    className="block border-t border-border px-4 py-3 text-sm hover:bg-surface-2"
                  >
                    🗺️ Google Maps
                  </a>
                </div>
              )}
            </div>
          )}
          {isRider && ride.status === "accepted" && arriving && (
            <p className="mt-3 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent">
              {driverProfile?.display_name?.split(" ")[0] ?? "Your driver"} is arriving —
              look for {driverProfile?.vehicle_color ? `a ${driverProfile.vehicle_color} ` : "the "}
              {driverProfile?.vehicle_make_model ?? "vehicle"}
              {driverProfile?.vehicle_plate ? `, plate ${driverProfile.vehicle_plate}` : ""}.
            </p>
          )}
          {ride.status === "in_progress" && (
            <p className="mt-3 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">
              🚗 Ride in progress — enjoy the trip!
            </p>
          )}
        </div>
      )}

      {/* Chat */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !otherTyping ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-2xl">💬</span>
            <p className="text-sm text-muted">Say hi and coordinate your pickup.</p>
          </div>
        ) : (
          <>
            {messages.map((m) => {
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
            })}
            {otherTyping && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl bg-surface-2 px-4 py-3">
                  <span className="hm-dot" />
                  <span className="hm-dot" />
                  <span className="hm-dot" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Composer + actions */}
      <div className="pb-safe border-t border-border bg-surface px-4 pt-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => handleInput(e.target.value)}
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
          {/* Trip options dropover (bottom-left) */}
          <div className="relative">
            <button
              onClick={() => setOptionsOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted"
            >
              ⋯ Trip options
            </button>
            {optionsOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-52 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                {isRider && (
                  <button
                    onClick={shareTrip}
                    className="block w-full px-4 py-3 text-left text-sm hover:bg-surface-2"
                  >
                    {copied ? "Link copied!" : "🔗 Share trip"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setOptionsOpen(false);
                    setCancelReason("");
                    setCancelOpen(true);
                  }}
                  className={`block w-full px-4 py-3 text-left text-sm hover:bg-surface-2 ${
                    isRider ? "border-t border-border" : ""
                  }`}
                >
                  ✖ Cancel trip
                </button>
                <button
                  onClick={report}
                  className="block w-full border-t border-border px-4 py-3 text-left text-sm text-danger hover:bg-surface-2"
                >
                  ⚠ Report / block
                </button>
              </div>
            )}
          </div>
          <button
            onClick={ride.status === "accepted" ? startRide : completeRide}
            className="text-sm font-medium text-success"
          >
            {ride.status === "accepted"
              ? isDriver
                ? "Start ride"
                : "I've been picked up"
              : "Complete ride"}
          </button>
        </div>
      </div>

      {/* Click-away for open menus */}
      {(optionsOpen || navOpen) && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setOptionsOpen(false);
            setNavOpen(false);
          }}
        />
      )}
      {cancelModal}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { createClient } from "@/lib/supabase/client";
import { haversineMeters, formatDistance } from "@/lib/geo";
import AddressAutocomplete, {
  type AddressSelection,
} from "@/components/AddressAutocomplete";
import { MAP_CHANNEL } from "@/lib/rideEvents";
import type { Ride } from "@/lib/types";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const FALLBACK = { lat: 37.7749, lng: -122.4194 };
// A confirmed pickup must be within this distance of the device's real GPS.
const MAX_PICKUP_DRIFT_M = 800;

type Mode = "ride" | "drive";
type RiderInfo = { display_name: string | null; photo_url: string | null };
type Confirmed = { lat: number; lng: number; label: string | null; address: string };

export default function MapView({
  userId,
  canDrive,
}: {
  userId: string;
  canDrive: boolean;
}) {
  if (!KEY) {
    return (
      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-8 text-center pt-safe pb-safe">
        <span className="text-3xl">🗺️</span>
        <h1 className="text-xl font-bold">Add your Google Maps key</h1>
        <p className="text-sm text-muted">
          Set <code className="text-accent">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          in <code>.env.local</code> and restart the dev server to load the map.
        </p>
      </main>
    );
  }
  return (
    <APIProvider apiKey={KEY}>
      <MapInner userId={userId} canDrive={canDrive} />
    </APIProvider>
  );
}

function MapInner({ userId, canDrive }: { userId: string; canDrive: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const map = useMap();

  const [mode, setMode] = useState<Mode>("ride");
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [openRides, setOpenRides] = useState<Ride[]>([]);
  const [riders, setRiders] = useState<Record<string, RiderInfo>>({});
  const [selected, setSelected] = useState<Ride | null>(null);
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Pickup address confirmation state.
  const [address, setAddress] = useState("");
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [addrError, setAddrError] = useState("");
  const [selectedCross, setSelectedCross] = useState<string | null>(null);
  const detectedRef = useRef(false);
  const centeredOnce = useRef(false);
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Locate the user and recenter the map there once.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyPos(p);
        if (!centeredOnce.current && map) {
          map.setCenter(p);
          map.setZoom(15);
          centeredOnce.current = true;
        }
      },
      () => {},
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [map]);

  // Reverse-geocode the first GPS fix to prefill the pickup address.
  useEffect(() => {
    if (!myPos || detectedRef.current) return;
    detectedRef.current = true;
    (async () => {
      try {
        const r = await fetch("/api/geocode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: myPos.lat, lng: myPos.lng }),
        });
        const g = r.ok ? await r.json() : null;
        setAddress(g?.formattedAddress ?? "");
        setConfirmed({
          lat: myPos.lat,
          lng: myPos.lng,
          label: g?.label ?? null,
          address: g?.formattedAddress ?? "",
        });
      } catch {
        setConfirmed({ lat: myPos.lat, lng: myPos.lng, label: null, address: "" });
      }
    })();
  }, [myPos]);

  // Recenter the map on the confirmed pickup point.
  useEffect(() => {
    if (map && confirmed) map.panTo({ lat: confirmed.lat, lng: confirmed.lng });
  }, [confirmed?.lat, confirmed?.lng, map]);

  const fetchOpen = useCallback(async () => {
    const { data } = await supabase
      .from("hitchmate_rides")
      .select("*")
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString())
      .neq("rider_id", userId)
      .returns<Ride[]>();
    const rides = data ?? [];
    setOpenRides(rides);
    const ids = [...new Set(rides.map((r) => r.rider_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("hitchmate_profiles")
        .select("id, display_name, photo_url")
        .in("id", ids)
        .returns<(RiderInfo & { id: string })[]>();
      const rmap: Record<string, RiderInfo> = {};
      profs?.forEach(
        (p) => (rmap[p.id] = { display_name: p.display_name, photo_url: p.photo_url }),
      );
      setRiders(rmap);
    }
  }, [supabase, userId]);

  // Live-refresh open rides. New rides arrive via postgres_changes INSERT.
  // Removals (cancel/accept) can't come that way — once a ride leaves 'open',
  // RLS hides it from non-owners — so we listen for a "ride_gone" broadcast.
  // A slow poll is a safety net for expiry and any missed events.
  useEffect(() => {
    fetchOpen();
    const ch = supabase
      .channel(MAP_CHANNEL, { config: { broadcast: { self: false } } })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "hitchmate_rides" },
        () => fetchOpen(),
      )
      .on(
        "broadcast",
        { event: "ride_gone" },
        (msg: { payload: { id: string } }) => {
          const id = msg.payload.id;
          setOpenRides((rs) => rs.filter((r) => r.id !== id));
          setSelected((s) => (s?.id === id ? null : s));
        },
      )
      .subscribe();
    chRef.current = ch;
    const poll = setInterval(fetchOpen, 20000);
    return () => {
      supabase.removeChannel(ch);
      chRef.current = null;
      clearInterval(poll);
    };
  }, [supabase, fetchOpen]);

  // When a pin is selected, resolve cross streets for its fuzzed area (privacy
  // preserved — this geocodes the ~300m approx point, not the exact location).
  useEffect(() => {
    if (!selected) {
      setSelectedCross(null);
      return;
    }
    let cancelled = false;
    setSelectedCross(null);
    fetch("/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: selected.approx_lat, lng: selected.approx_lng }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setSelectedCross(d?.crossStreets ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function onSelectAddress(sel: AddressSelection) {
    if (myPos) {
      const d = haversineMeters({ lat: sel.lat, lng: sel.lng }, myPos);
      if (d > MAX_PICKUP_DRIFT_M) {
        setAddrError(
          `That address is ${formatDistance(d)} from where you are — pick a spot near you.`,
        );
        return;
      }
    }
    setAddrError("");
    setConfirmed({ lat: sel.lat, lng: sel.lng, label: sel.label, address: sel.address });
  }

  async function requestPickup() {
    if (!confirmed) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("hitchmate_create_ride", {
      p_exact_lat: confirmed.lat,
      p_exact_lng: confirmed.lng,
      p_destination_note: dest.trim() || null,
      p_note: null,
      p_approx_label: confirmed.label,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/ride/${data}`);
  }

  async function accept(ride: Ride) {
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("hitchmate_accept_ride", {
      p_ride_id: ride.id,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      setSelected(null);
      fetchOpen();
      return;
    }
    // Tell other browsing maps this pin is gone.
    chRef.current?.send({
      type: "broadcast",
      event: "ride_gone",
      payload: { id: ride.id },
    });
    router.push(`/ride/${ride.id}`);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  // Pickup is confirmable only when the typed text matches a resolved location
  // (GPS-detected or a picked suggestion) — prevents creating at stale coords.
  const canConfirm = !!confirmed && address === confirmed.address;
  const pickupPin = confirmed
    ? { lat: confirmed.lat, lng: confirmed.lng }
    : myPos;

  return (
    <div className="relative flex-1">
      <Map
        defaultCenter={myPos ?? FALLBACK}
        defaultZoom={14}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        className="absolute inset-0"
      >
        {mode === "ride" && pickupPin && <Marker position={pickupPin} />}
        {mode === "drive" &&
          openRides.map((r) => (
            <Marker
              key={r.id}
              position={{ lat: r.approx_lat, lng: r.approx_lng }}
              onClick={() => setSelected(r)}
            />
          ))}
      </Map>

      {/* Top bar */}
      <div className="pt-safe absolute inset-x-0 top-0 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 rounded-full bg-surface/90 px-3 py-1.5 backdrop-blur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={22} height={22} className="rounded-md" />
          <span className="text-sm font-bold">HitchMate</span>
        </div>
        <button
          onClick={signOut}
          className="rounded-full bg-surface/90 px-3 py-1.5 text-xs text-muted backdrop-blur"
        >
          Sign out
        </button>
      </div>

      {/* Mode toggle */}
      <div className="absolute inset-x-0 top-16 flex justify-center">
        <div className="flex rounded-full bg-surface/90 p-1 backdrop-blur">
          {(["ride", "drive"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setSelected(null);
              }}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                mode === m ? "bg-accent text-accent-fg" : "text-muted"
              }`}
            >
              {m === "ride" ? "Request a ride" : "Give a ride"}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom sheet */}
      <div className="pb-safe absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-md rounded-t-3xl border-t border-border bg-surface px-6 pt-5">
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}

          {mode === "ride" ? (
            <div className="flex flex-col gap-3 pb-6">
              <p className="text-sm text-muted">
                Confirm your pickup spot. Drivers see only an approximate area
                until one accepts.
              </p>
              <AddressAutocomplete
                value={address}
                onChange={(t) => setAddress(t)}
                onSelect={onSelectAddress}
                bias={myPos ?? undefined}
                placeholder="Your pickup address"
              />
              {addrError && <p className="text-sm text-danger">{addrError}</p>}
              {!myPos && (
                <p className="text-xs text-muted">
                  Turn on location so we can verify you&apos;re nearby.
                </p>
              )}
              <input
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="Where are you heading? (optional)"
                className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
              />
              <button
                onClick={requestPickup}
                disabled={busy || !canConfirm}
                className="btn-accent h-14 rounded-2xl"
              >
                {busy ? "Requesting…" : "Confirm pickup"}
              </button>
              {!canConfirm && address.length > 0 && (
                <p className="text-center text-xs text-muted">
                  Pick an address from the list to confirm your location.
                </p>
              )}
            </div>
          ) : !canDrive ? (
            <div className="flex flex-col gap-3 pb-6 text-center">
              <p className="text-sm text-muted">
                Add your vehicle details to start giving rides.
              </p>
              <Link
                href="/onboarding"
                className="btn-accent flex h-14 items-center justify-center rounded-2xl"
              >
                Add vehicle info
              </Link>
            </div>
          ) : (
            <div className="pb-6">
              <p className="mb-2 text-sm font-medium">
                {openRides.length
                  ? `${openRides.length} rider${openRides.length > 1 ? "s" : ""} nearby`
                  : "No open requests right now"}
              </p>
              <p className="text-sm text-muted">
                Tap a pin to see the rider and accept their pickup.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Selected ride detail (drive mode) */}
      {selected && (
        <div
          className="absolute inset-0 z-20 flex items-end bg-black/50"
          onClick={() => setSelected(null)}
        >
          <div
            className="pb-safe mx-auto w-full max-w-md rounded-t-3xl border-t border-border bg-surface px-6 pt-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 overflow-hidden rounded-2xl bg-surface-2">
                {riders[selected.rider_id]?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={riders[selected.rider_id].photo_url!}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex-1">
                <p className="font-semibold">
                  {riders[selected.rider_id]?.display_name ?? "Rider"}
                </p>
                <p className="text-sm text-muted">
                  📍 {selectedCross ?? selected.approx_label ?? "Approximate area"}
                  {selectedCross && selected.approx_label
                    ? ` · ${selected.approx_label}`
                    : ""}
                </p>
                <p className="text-xs text-muted">
                  {selected.destination_note
                    ? `Heading: ${selected.destination_note}`
                    : "No destination given"}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-3 pb-6">
              <button
                onClick={() => accept(selected)}
                disabled={busy}
                className="btn-accent h-14 rounded-2xl"
              >
                {busy ? "Accepting…" : "Accept pickup"}
              </button>
              <button
                onClick={() => setSelected(null)}
                className="py-2 text-sm text-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

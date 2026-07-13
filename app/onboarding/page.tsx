"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import LivenessCapture from "@/components/LivenessCapture";
import type { Profile } from "@/lib/types";

export default function Onboarding() {
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [wantsDrive, setWantsDrive] = useState(false);
  const [vehicle, setVehicle] = useState({ make_model: "", color: "", plate: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }
      setUserId(user.id);
      setName(
        (user.user_metadata?.full_name as string) ??
          (user.user_metadata?.name as string) ??
          "",
      );
      const { data } = await supabase
        .from("hitchmate_profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle<Profile>();
      if (data) {
        if (data.display_name) setName(data.display_name);
        if (data.photo_url) setPhotoUrl(data.photo_url);
        if (data.vehicle_make_model) {
          setWantsDrive(true);
          setVehicle({
            make_model: data.vehicle_make_model ?? "",
            color: data.vehicle_color ?? "",
            plate: data.vehicle_plate ?? "",
          });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCaptured(blob: Blob, previewUrl: string) {
    setCapturing(false);
    if (!userId) return;
    setError("");
    setPhotoUrl(previewUrl); // instant local preview
    // Stable path so a retake overwrites the previous selfie (no orphaned files).
    const path = `${userId}/selfie.jpg`;
    const { error: upErr } = await supabase.storage
      .from("hitchmate-avatars")
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      setError("We couldn't save your selfie. Please try again.");
      return;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("hitchmate-avatars").getPublicUrl(path);
    // Cache-bust so a retake shows the new photo, not the CDN-cached old one.
    setPhotoUrl(`${publicUrl}?t=${Date.now()}`);
  }

  async function save() {
    if (!userId) return;
    setError("");
    setSaving(true);
    const { error: saveErr } = await supabase.from("hitchmate_profiles").upsert(
      {
        id: userId,
        display_name: name.trim(),
        photo_url: photoUrl,
        liveness_passed: true,
        vehicle_make_model: wantsDrive ? vehicle.make_model.trim() || null : null,
        vehicle_color: wantsDrive ? vehicle.color.trim() || null : null,
        vehicle_plate: wantsDrive ? vehicle.plate.trim().toUpperCase() || null : null,
      },
      { onConflict: "id" },
    );
    setSaving(false);
    if (saveErr) {
      setError("Something went wrong saving your profile. Please try again.");
      return;
    }
    router.replace("/map");
  }

  const photoIsRemote = photoUrl?.startsWith("http");
  const canSave =
    name.trim().length > 1 &&
    photoIsRemote &&
    (!wantsDrive || (vehicle.make_model.trim() && vehicle.plate.trim()));

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 pt-safe pb-safe">
      <header className="pt-6">
        <h1 className="text-2xl font-bold">Set up your profile</h1>
        <p className="mt-1 text-sm text-muted">
          A name and a live selfie are required so the person picking you up (or
          the rider you pick up) knows who to look for.
        </p>
      </header>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Display name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alex"
          className="rounded-xl border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
        />
      </label>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Live selfie</span>
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Selfie" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl">
                🙂
              </div>
            )}
          </div>
          <button
            onClick={() => setCapturing(true)}
            className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium"
          >
            {photoUrl ? "Retake live selfie" : "Take live selfie"}
          </button>
        </div>
        <p className="text-xs text-muted">
          A quick liveness check (center, turn, blink) confirms a real person —
          it deters fake photos. It is not identity verification.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium">I want to give rides too</span>
          <input
            type="checkbox"
            checked={wantsDrive}
            onChange={(e) => setWantsDrive(e.target.checked)}
            className="h-5 w-5 accent-[var(--accent)]"
          />
        </label>
        {wantsDrive && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-muted">
              Riders see this so they can spot your vehicle at pickup.
            </p>
            <input
              value={vehicle.make_model}
              onChange={(e) => setVehicle({ ...vehicle, make_model: e.target.value })}
              placeholder="Make & model (e.g. Silver Ford Transit)"
              className="rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
            />
            <div className="flex gap-3">
              <input
                value={vehicle.color}
                onChange={(e) => setVehicle({ ...vehicle, color: e.target.value })}
                placeholder="Color"
                className="w-1/2 rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
              />
              <input
                value={vehicle.plate}
                onChange={(e) => setVehicle({ ...vehicle, plate: e.target.value })}
                placeholder="Plate"
                className="w-1/2 rounded-xl border border-border bg-surface-2 px-4 py-3 uppercase outline-none focus:border-accent"
              />
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="mt-auto pb-4">
        <button
          onClick={save}
          disabled={!canSave || saving}
          className="btn-accent h-14 w-full rounded-2xl"
        >
          {saving ? "Saving…" : "Save & continue"}
        </button>
      </div>

      {capturing && (
        <LivenessCapture
          onComplete={handleCaptured}
          onCancel={() => setCapturing(false)}
        />
      )}
    </main>
  );
}

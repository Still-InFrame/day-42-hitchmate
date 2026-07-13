import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { metersToMiles } from "@/lib/geo";
import Greeting from "@/components/Greeting";
import SignOutButton from "@/components/SignOutButton";
import type { Profile, RideStatus } from "@/lib/types";

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("hitchmate_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  if (!profile || !profile.display_name || !profile.liveness_passed) {
    redirect("/onboarding");
  }

  const { data: active } = await supabase
    .from("hitchmate_rides")
    .select("id, status")
    .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
    .in("status", ["open", "accepted", "in_progress"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: RideStatus }>();

  const { data: milesRows } = await supabase
    .from("hitchmate_rides")
    .select("distance_meters")
    .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
    .eq("status", "completed")
    .returns<{ distance_meters: number | null }[]>();
  const totalMiles = metersToMiles(
    (milesRows ?? []).reduce((s, r) => s + (r.distance_meters ?? 0), 0),
  );
  const ridesCompleted = (milesRows ?? []).length;

  const firstName = profile!.display_name!.split(" ")[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 pt-safe pb-safe">
      <header className="flex items-center justify-between pt-8">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
          <span className="text-lg font-bold">HitchMate</span>
        </div>
        <SignOutButton className="rounded-full border border-border px-3 py-1.5 text-xs text-muted" />
      </header>

      <div>
        <Greeting name={firstName} />
        {profile!.rating_count > 0 && profile!.rating_avg != null && (
          <p className="mt-1 text-sm text-muted">
            <span className="text-accent">★ {profile!.rating_avg.toFixed(1)}</span> ·{" "}
            {profile!.rating_count} rating{profile!.rating_count > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {active && (
        <Link
          href={`/ride/${active.id}`}
          className="pulse-glow block rounded-2xl bg-accent p-5 text-accent-fg"
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            {active.status === "open" ? "Waiting for a driver" : "Ride in progress"}
          </p>
          <p className="mt-1 text-xl font-bold">▶ View Live Trip</p>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Miles traveled</p>
          <p className="mt-1 text-3xl font-bold">
            {totalMiles.toFixed(1)}{" "}
            <span className="text-base font-medium text-muted">mi</span>
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Rides completed</p>
          <p className="mt-1 text-3xl font-bold">{ridesCompleted}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {!active && (
          <Link
            href="/map"
            className="btn-accent flex h-14 items-center justify-center rounded-2xl"
          >
            Request or give a ride
          </Link>
        )}
        <Link
          href="/history"
          className="flex h-14 items-center justify-between rounded-2xl border border-border bg-surface px-5"
        >
          <span className="font-medium">🕘 Ride history</span>
          <span className="text-muted">›</span>
        </Link>
      </div>
    </main>
  );
}

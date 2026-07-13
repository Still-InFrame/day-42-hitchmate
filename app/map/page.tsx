import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MapView from "@/components/MapView";
import type { Profile } from "@/lib/types";

export default async function MapPage() {
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

  // Must finish onboarding (name + live selfie) before using the map.
  if (!profile || !profile.display_name || !profile.liveness_passed) {
    redirect("/onboarding");
  }

  // If already in an active ride, jump straight into it.
  const { data: active } = await supabase
    .from("hitchmate_rides")
    .select("id")
    .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
    .in("status", ["open", "accepted", "in_progress"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (active) redirect(`/ride/${active.id}`);

  return (
    <MapView
      userId={user.id}
      canDrive={
        !!profile!.vehicle_make_model && !!profile!.vehicle_plate
      }
    />
  );
}

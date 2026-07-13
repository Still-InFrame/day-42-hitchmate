import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RideRoom from "@/components/RideRoom";
import type { Ride, RideLocation, Profile } from "@/lib/types";

export default async function RidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: ride } = await supabase
    .from("hitchmate_rides")
    .select("*")
    .eq("id", id)
    .maybeSingle<Ride>();

  if (!ride || (ride.rider_id !== user.id && ride.driver_id !== user.id)) {
    redirect("/map");
  }

  const { data: loc } = await supabase
    .from("hitchmate_ride_locations")
    .select("*")
    .eq("ride_id", id)
    .maybeSingle<RideLocation>();

  const ids = [ride!.rider_id, ride!.driver_id].filter(Boolean) as string[];
  const { data: profs } = await supabase
    .from("hitchmate_profiles")
    .select("*")
    .in("id", ids)
    .returns<Profile[]>();

  const rider = profs?.find((p) => p.id === ride!.rider_id) ?? null;
  const driver = profs?.find((p) => p.id === ride!.driver_id) ?? null;

  return (
    <RideRoom
      userId={user.id}
      initialRide={ride!}
      initialLoc={loc ?? null}
      rider={rider}
      driver={driver}
    />
  );
}

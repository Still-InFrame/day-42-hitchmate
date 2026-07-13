import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JourneyMap from "@/components/JourneyMap";
import type { Ride, RideLocation } from "@/lib/types";

export default async function HistoryDetail({
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
    redirect("/history");
  }

  const { data: loc } = await supabase
    .from("hitchmate_ride_locations")
    .select("*")
    .eq("ride_id", id)
    .maybeSingle<RideLocation>();
  const { data: track } = await supabase
    .from("hitchmate_ride_track")
    .select("lat, lng")
    .eq("ride_id", id)
    .order("recorded_at", { ascending: true })
    .returns<{ lat: number; lng: number }[]>();

  return (
    <JourneyMap
      ride={ride!}
      start={loc ? { lat: loc.exact_lat, lng: loc.exact_lng } : null}
      track={track ?? []}
      viewerIsRider={ride!.rider_id === user.id}
    />
  );
}

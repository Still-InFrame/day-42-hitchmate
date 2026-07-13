import type { SupabaseClient } from "@supabase/supabase-js";

export const MAP_CHANNEL = "hm_open_rides_bcast";

// Announce that a ride left the open pool so browsing maps drop its pin
// instantly. Needed because once a ride is no longer 'open', RLS hides it from
// non-owners, so the postgres_changes UPDATE never reaches other drivers.
// Fire-and-forget from a transient channel (used where the map isn't mounted).
export function announceRideGone(supabase: SupabaseClient, rideId: string) {
  const ch = supabase.channel(MAP_CHANNEL);
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      ch.send({ type: "broadcast", event: "ride_gone", payload: { id: rideId } });
      setTimeout(() => supabase.removeChannel(ch), 1500);
    }
  });
}

export const tripChannel = (token: string) => `trip:${token}`;

// Ping a public share-token channel so anyone following the shared trip link
// refetches immediately when the stage changes (started, completed, cancelled).
export function announceTripUpdate(supabase: SupabaseClient, shareToken: string) {
  const ch = supabase.channel(tripChannel(shareToken));
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      ch.send({ type: "broadcast", event: "update", payload: {} });
      setTimeout(() => supabase.removeChannel(ch), 1500);
    }
  });
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { metersToMiles } from "@/lib/geo";
import type { Ride } from "@/lib/types";

export default async function HistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: rides } = await supabase
    .from("hitchmate_rides")
    .select("*")
    .or(`rider_id.eq.${user.id},driver_id.eq.${user.id}`)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .returns<Ride[]>();
  const list = rides ?? [];

  const otherIds = [
    ...new Set(
      list
        .map((r) => (r.rider_id === user.id ? r.driver_id : r.rider_id))
        .filter(Boolean) as string[],
    ),
  ];
  const { data: profs } = otherIds.length
    ? await supabase
        .from("hitchmate_profiles")
        .select("id, display_name")
        .in("id", otherIds)
        .returns<{ id: string; display_name: string | null }[]>()
    : { data: [] as { id: string; display_name: string | null }[] };
  const names = new Map((profs ?? []).map((p) => [p.id, p.display_name]));

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-6 pt-safe pb-safe">
      <header className="flex items-center gap-3 pt-6">
        <Link href="/map" className="text-sm text-muted">
          ← Map
        </Link>
        <h1 className="text-2xl font-bold">Ride history</h1>
      </header>

      {list.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted">
          No completed rides yet. Your past hitchhikes will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((r) => {
            const asRider = r.rider_id === user.id;
            const other =
              names.get((asRider ? r.driver_id : r.rider_id) ?? "") ?? "Unknown";
            const miles = r.distance_meters != null ? metersToMiles(r.distance_meters) : null;
            const date = r.ended_at ? new Date(r.ended_at) : null;
            return (
              <li key={r.id}>
                <Link
                  href={`/history/${r.id}`}
                  className="block rounded-2xl border border-border bg-surface p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">
                      {asRider ? `Ride with ${other}` : `Drove ${other}`}
                    </p>
                    {miles != null && (
                      <span className="text-sm font-medium text-accent">
                        {miles.toFixed(1)} mi
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {date
                      ? date.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                    {r.approx_label ? ` · ${r.approx_label}` : ""}
                    {asRider ? " · as rider" : " · as driver"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

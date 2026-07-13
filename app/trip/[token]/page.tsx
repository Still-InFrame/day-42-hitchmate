import SharedTrip from "@/components/SharedTrip";

// Public, no auth — anyone with the unguessable token can follow the trip.
export default async function TripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedTrip token={token} />;
}

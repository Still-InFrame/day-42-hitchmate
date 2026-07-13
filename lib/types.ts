export type RideStatus =
  | "open"
  | "accepted"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Profile {
  id: string;
  display_name: string | null;
  photo_url: string | null;
  liveness_passed: boolean;
  vehicle_make_model: string | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
  rating_avg: number | null;
  rating_count: number;
  created_at: string;
}

export interface Ride {
  id: string;
  rider_id: string;
  driver_id: string | null;
  status: RideStatus;
  approx_lat: number;
  approx_lng: number;
  approx_label: string | null;
  destination_note: string | null;
  note: string | null;
  share_token: string;
  created_at: string;
  expires_at: string;
  cancel_reason: string | null;
  cancelled_by: string | null;
  started_at: string | null;
  ended_at: string | null;
  end_lat: number | null;
  end_lng: number | null;
  distance_meters: number | null;
}

export interface RideLocation {
  ride_id: string;
  exact_lat: number;
  exact_lng: number;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_updated_at: string | null;
}

export interface Message {
  id: string;
  ride_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

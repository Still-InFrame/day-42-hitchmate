import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything except static assets, images, and the vendored
  // MediaPipe wasm/model files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|mediapipe-wasm|models|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|task|wasm)$).*)",
  ],
};

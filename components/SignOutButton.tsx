"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }
  return (
    <button onClick={signOut} className={className}>
      Sign out
    </button>
  );
}

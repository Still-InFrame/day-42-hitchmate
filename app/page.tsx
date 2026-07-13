import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignInButton from "@/components/SignInButton";

const FEATURES = [
  { icon: "📍", title: "Drop a pin", body: "Mark where you are. Nearby drivers see an approximate area — never your exact spot." },
  { icon: "🤝", title: "Get matched", body: "A driver accepts your pickup. Only then do they get your exact location." },
  { icon: "🛡️", title: "Ride safe", body: "Live selfie check, in-app chat, and a heads-up when your driver is arriving." },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/map");

  return (
    <main className="flex flex-1 flex-col justify-between px-6 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10 py-10">
        <header className="text-center">
          <div className="mb-4 inline-flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={44} height={44} className="rounded-xl" />
            <span className="text-2xl font-bold tracking-tight">HitchMate</span>
          </div>
          <h1 className="text-3xl font-bold leading-tight">
            Stick out your thumb,{" "}
            <span className="text-accent">digitally.</span>
          </h1>
          <p className="mt-3 text-muted">
            A safer way to hitch a ride — drop a pin, get seen by nearby drivers,
            and connect until pickup.
          </p>
        </header>

        <ul className="flex flex-col gap-4">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="flex gap-4 rounded-2xl border border-border bg-surface p-4"
            >
              <span className="text-2xl" aria-hidden>{f.icon}</span>
              <div>
                <p className="font-semibold">{f.title}</p>
                <p className="text-sm text-muted">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mx-auto w-full max-w-md">
        <SignInButton />
        <p className="mt-3 text-center text-xs text-muted">
          Sign-in keeps the community accountable. Use good judgment — HitchMate
          helps you connect, but you choose who you ride with.
        </p>
      </div>
    </main>
  );
}

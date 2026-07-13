"use client";

import { useEffect, useState } from "react";

// Time-of-day greeting computed on the client so it matches the viewer's clock.
export default function Greeting({ name }: { name: string }) {
  const [part, setPart] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return (
    <h1 className="text-2xl font-bold">
      {part}, {name} 👋
    </h1>
  );
}

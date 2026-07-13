"use client";

import { useEffect, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

export interface AddressSelection {
  address: string;
  lat: number;
  lng: number;
  label: string | null;
}

// Coarse area label (never house number) from Places address components.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelFromComponents(comps: any[]): string | null {
  const pick = (t: string) =>
    comps?.find((c: { types?: string[] }) => c.types?.includes(t))?.longText;
  return pick("neighborhood") ?? pick("sublocality") ?? pick("locality") ?? null;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  bias,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect: (sel: AddressSelection) => void;
  bias?: { lat: number; lng: number };
  placeholder?: string;
}) {
  const places = useMapsLibrary("places");
  const [suggestions, setSuggestions] = useState<
    { id: string; text: string; prediction: unknown }[]
  >([]);
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenRef = useRef<any>(null);
  const debounceRef = useRef<number>(0);

  useEffect(() => {
    if (!places) return;
    if (!value || value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const P = places as any;
        if (!tokenRef.current) tokenRef.current = new P.AutocompleteSessionToken();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req: any = { input: value, sessionToken: tokenRef.current };
        if (bias) req.locationBias = { center: bias, radius: 8000 };
        const { suggestions: raw } =
          await P.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        setSuggestions(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (raw ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((s: any) => s.placePrediction)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((s: any) => ({
              id: s.placePrediction.placeId,
              text: s.placePrediction.text?.text ?? "",
              prediction: s.placePrediction,
            })),
        );
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [value, places, bias?.lat, bias?.lng]);

  async function choose(s: { text: string; prediction: unknown }) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const place = (s.prediction as any).toPlace();
      await place.fetchFields({
        fields: ["location", "formattedAddress", "addressComponents"],
      });
      onSelect({
        address: place.formattedAddress ?? s.text,
        lat: place.location.lat(),
        lng: place.location.lng(),
        label: labelFromComponents(place.addressComponents ?? []),
      });
      onChange(place.formattedAddress ?? s.text);
      tokenRef.current = null; // end the billing session after a selection
      setSuggestions([]);
      setOpen(false);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 outline-none focus:border-accent"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute bottom-full z-30 mb-2 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-xl">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => choose(s)}
                className="block w-full px-4 py-3 text-left text-sm hover:bg-surface-2"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

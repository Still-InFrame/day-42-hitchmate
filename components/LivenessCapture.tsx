"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { loadFaceLandmarker, getFaceSignals } from "@/lib/faceLiveness";

type Phase = "loading" | "center" | "turn" | "blink" | "preview" | "error";

const CENTER_HOLD_MS = 600;
const TURN_THRESH = 0.12; // normalized nose offset that counts as a head turn
const FORWARD_THRESH = 0.08; // back-to-forward tolerance
const BLINK_HIGH = 0.6;
const BLINK_LOW = 0.3;

const COPY: Record<Exclude<Phase, "preview" | "error">, { title: string; sub: string }> = {
  loading: { title: "Starting camera…", sub: "Allow camera access to continue." },
  center: { title: "Center your face", sub: "Fit your face inside the oval." },
  turn: { title: "Turn your head", sub: "Slowly turn to either side, then back." },
  blink: { title: "Face forward and blink", sub: "Look at the camera and blink once." },
};

export default function LivenessCapture({
  onComplete,
  onCancel,
}: {
  onComplete: (blob: Blob, previewUrl: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  // Loop state kept in refs to survive re-renders without restarting the camera.
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;
  const centeredSinceRef = useRef<number | null>(null);
  const blinkArmedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setPreview(url);
        setPhase("preview");
        stop();
      },
      "image/jpeg",
      0.85,
    );
  }, [stop]);

  useEffect(() => {
    let cancelled = false;
    let landmarker: FaceLandmarker | null = null;

    async function begin() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        landmarker = await loadFaceLandmarker();
        if (cancelled) return;
        setPhase("center");
        loop(landmarker);
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera access was blocked. Enable it in your browser settings and try again."
            : "Couldn't start the camera on this device.",
        );
        setPhase("error");
      }
    }

    function loop(fl: FaceLandmarker) {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(() => loop(fl));
        return;
      }
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const result = fl.detectForVideo(video, ts);
      const s = getFaceSignals(result);
      const now = ts;
      const p = phaseRef.current;

      if (p === "center") {
        if (s.present && s.centered) {
          centeredSinceRef.current ??= now;
          if (now - (centeredSinceRef.current ?? now) >= CENTER_HOLD_MS) {
            setPhase("turn");
          }
        } else {
          centeredSinceRef.current = null;
        }
      } else if (p === "turn") {
        if (s.present && Math.abs(s.turnOffset) > TURN_THRESH) {
          setPhase("blink");
          blinkArmedRef.current = false;
        }
      } else if (p === "blink") {
        const forward = s.present && Math.abs(s.turnOffset) < FORWARD_THRESH;
        if (forward && s.blinkScore > BLINK_HIGH) blinkArmedRef.current = true;
        // Capture on the reopening edge so the still has open eyes.
        if (blinkArmedRef.current && forward && s.blinkScore < BLINK_LOW) {
          capture();
          return;
        }
      }

      rafRef.current = requestAnimationFrame(() => loop(fl));
    }

    begin();
    return () => {
      cancelled = true;
      stop();
    };
    // runId change restarts the whole capture (used by Retake).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture, stop, runId]);

  function retake() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    blobRef.current = null;
    centeredSinceRef.current = null;
    blinkArmedRef.current = false;
    lastTsRef.current = 0;
    setPhase("loading");
    setRunId((n) => n + 1); // restarts the capture effect
  }

  const step = phase === "center" ? 1 : phase === "turn" ? 2 : phase === "blink" ? 3 : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black pt-safe pb-safe">
      {phase === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-lg font-semibold">Camera unavailable</p>
          <p className="text-sm text-muted">{errorMsg}</p>
          <button onClick={onCancel} className="btn-accent mt-2 rounded-xl px-6 py-3">
            Go back
          </button>
        </div>
      ) : phase === "preview" && preview ? (
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your selfie" className="h-full w-full object-cover" />
          </div>
          <div className="flex flex-col gap-3 px-6 py-5">
            <p className="text-center text-sm text-muted">
              Liveness check passed. Use this photo?
            </p>
            <button
              onClick={() => blobRef.current && onComplete(blobRef.current, preview)}
              className="btn-accent h-13 rounded-2xl py-4"
            >
              Use this photo
            </button>
            <button onClick={retake} className="py-2 text-sm text-muted">
              Retake
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
            {/* Oval guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="h-64 w-52 rounded-[50%] border-4 transition-colors"
                style={{ borderColor: step >= 1 ? "var(--accent)" : "rgba(255,255,255,0.4)" }}
              />
            </div>
            <button
              onClick={onCancel}
              className="absolute right-4 top-4 rounded-full bg-black/50 px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
          <div className="px-6 py-5 text-center">
            <div className="mb-3 flex justify-center gap-2">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className="h-1.5 w-10 rounded-full"
                  style={{ background: step >= n ? "var(--accent)" : "var(--surface-2)" }}
                />
              ))}
            </div>
            <p className="text-lg font-semibold">
              {COPY[phase as keyof typeof COPY]?.title}
            </p>
            <p className="mt-1 text-sm text-muted">
              {COPY[phase as keyof typeof COPY]?.sub}
            </p>
            <p className="mt-3 text-xs text-muted">
              Your camera stays on your device. We keep only the final photo.
            </p>
          </div>
        </>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

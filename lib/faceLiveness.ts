// MediaPipe FaceLandmarker (478-point mesh), ported from day-31-visualme's
// meshEngine.ts. Runs entirely client-side; the camera stream never leaves the
// device. We keep only the loader + a few pure signal helpers used to drive a
// live-selfie liveness challenge — this blocks a still photo held to the camera,
// but is honestly a deterrent, NOT identity verification.
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

let loadPromise: Promise<FaceLandmarker> | null = null;

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const vision = await import("@mediapipe/tasks-vision");
      const { FaceLandmarker, FilesetResolver } = vision;
      // wasm runtime + model are vendored into public/ (zero external deps).
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe-wasm");
      const options = {
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
          delegate: "GPU" as const,
        },
        runningMode: "VIDEO" as const,
        numFaces: 1,
        outputFaceBlendshapes: true, // eye-blink categories
      };
      try {
        return await FaceLandmarker.createFromOptions(fileset, options);
      } catch {
        // Some mobile GPUs reject the GPU delegate; CPU still works.
        return await FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
        });
      }
    })();
  }
  return loadPromise;
}

export interface FaceSignals {
  present: boolean;
  centered: boolean;
  // Horizontal nose offset relative to face center, normalized by face width.
  // ~0 when facing forward; magnitude grows as the head turns either way.
  turnOffset: number;
  // Peak eye-blink score this frame (0..1); >~0.5 indicates a blink.
  blinkScore: number;
}

const NO_FACE: FaceSignals = {
  present: false,
  centered: false,
  turnOffset: 0,
  blinkScore: 0,
};

// Landmark indices (MediaPipe canonical face): nose tip + the two face-oval
// extremes at the cheeks.
const NOSE = 1;
const CHEEK_L = 234;
const CHEEK_R = 454;

export function getFaceSignals(result: FaceLandmarkerResult): FaceSignals {
  const lm = result.faceLandmarks?.[0];
  if (!lm || lm.length < 468) return NO_FACE;

  const nose = lm[NOSE];
  const cl = lm[CHEEK_L];
  const cr = lm[CHEEK_R];
  const faceWidth = Math.abs(cr.x - cl.x) || 1;
  const centerX = (cl.x + cr.x) / 2;
  const turnOffset = (nose.x - centerX) / faceWidth;

  // Centered = nose near frame center and face large enough to be close-up.
  const centered = nose.x > 0.3 && nose.x < 0.7 && faceWidth > 0.14;

  let blinkScore = 0;
  const cats = result.faceBlendshapes?.[0]?.categories;
  if (cats) {
    for (const c of cats) {
      if (c.categoryName === "eyeBlinkLeft" || c.categoryName === "eyeBlinkRight") {
        blinkScore = Math.max(blinkScore, c.score);
      }
    }
  }

  return { present: true, centered, turnOffset, blinkScore };
}

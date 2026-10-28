/** Frame-math helpers shared by every scene component. All animation is
 * frame-based (useCurrentFrame/interpolate/spring) — never CSS keyframes,
 * which are unreliable during headless rendering. */

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Ease out cubic */
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Ease in out cubic */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Ease out back — subtle overshoot for pop-ins */
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Normalized progress 0..1 over a window of frames, eased. */
export const prog = (frame: number, start: number, dur: number, ease: (t: number) => number = easeOut): number => {
  if (dur <= 0) return 1;
  return ease(clamp01((frame - start) / dur));
};

/** Multi-keyframe interpolation: keys = [{f, v}] sorted by f. */
export const kf = (frame: number, keys: Array<{f: number; v: number}>): number => {
  if (keys.length === 0) return 0;
  if (frame <= keys[0].f) return keys[0].v;
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.f && frame <= b.f) {
      const t = (frame - a.f) / Math.max(1, b.f - a.f);
      return a.v + (b.v - a.v) * t;
    }
  }
  return last.v;
};

/** Deterministic PRNG — same seed gives same particles/positions every render
 * (essential: non-deterministic randomness flickers across frames). */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Stable pseudo-random value from an integer id (no state). */
export const rand01 = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** px size scaled to composition height (design reference = 1080). */
export const scalePx = (px: number, height: number): number => (px / 1080) * height;

/** Cinematic camera transform for a given move over a scene's local frame. */
export const cameraTransform = (
  move: string | undefined,
  t: number, // 0..1 progress
  intensity: number,
): {scale: number; x: number; y: number} => {
  const amp = 0.06 + 0.1 * intensity;
  switch (move) {
    case 'push-in':
      return {scale: 1 + amp * t, x: 0, y: 0};
    case 'pull-out':
      return {scale: 1 + amp - amp * t, x: 0, y: 0};
    case 'pan-left':
      return {scale: 1 + amp * 0.5, x: amp * 50 * (1 - t) * 10, y: 0};
    case 'pan-right':
      return {scale: 1 + amp * 0.5, x: -amp * 50 * (1 - t) * 10, y: 0};
    case 'pan-up':
      return {scale: 1 + amp * 0.5, x: 0, y: -amp * 50 * (1 - t) * 10};
    case 'pan-down':
      return {scale: 1 + amp * 0.5, x: 0, y: amp * 50 * (1 - t) * 10};
    default:
      return {scale: 1, x: 0, y: 0};
  }
};
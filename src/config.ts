// ============================================================
// EternalFrame Auto-TikTok Engine — Config
// ============================================================

// Brand palette (matches EternalFrame app)
export const BRAND = {
  coral: '#E85A71',
  teal: '#3D9CA8',
  amber: '#FFB74D',
  dark: '#1A1A2E',
  darkSurface: '#16213E',
  white: '#FAFAFA',
  textLight: '#E8E8E8',
  textMuted: '#A0A0B0',
} as const;

// Video dimensions (TikTok 9:16)
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

// Template A: Before/After Reveal — timing in frames (@ 30fps)
export const REVEAL_TIMING = {
  totalDuration: 15 * VIDEO.fps, // 450 frames = 15 seconds

  // Phase 1: Hook text on blurred before image
  hookStart: 0,
  hookEnd: 2 * VIDEO.fps, // 0-2s

  // Phase 2: Before image with slow zoom
  beforeStart: Math.floor(0.5 * VIDEO.fps), // 0.5s (overlaps hook fade)
  beforeEnd: 6 * VIDEO.fps, // 6s

  // Phase 3: Swipe transition
  transitionStart: 5.5 * VIDEO.fps, // 5.5s
  transitionEnd: 7 * VIDEO.fps, // 7s

  // Phase 4: After image with slow pan
  afterStart: 6.5 * VIDEO.fps, // 6.5s
  afterEnd: 12 * VIDEO.fps, // 12s

  // Phase 5: CTA overlay
  ctaStart: 11.5 * VIDEO.fps, // 11.5s
  ctaEnd: 15 * VIDEO.fps, // 15s
} as const;

// Template B: Tips/Educational — timing in frames
export const TIPS_TIMING = {
  totalDuration: 15 * VIDEO.fps,

  // Phase 1: Hook question
  hookStart: 0,
  hookEnd: 3 * VIDEO.fps, // 0-3s

  // Phase 2: Tip content with visual
  tipStart: 2.5 * VIDEO.fps,
  tipEnd: 10 * VIDEO.fps, // 2.5-10s

  // Phase 3: Key takeaway
  takeawayStart: 9.5 * VIDEO.fps,
  takeawayEnd: 12.5 * VIDEO.fps,

  // Phase 4: CTA
  ctaStart: 12 * VIDEO.fps,
  ctaEnd: 15 * VIDEO.fps,
} as const;

// Easing helpers
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Multi-stop interpolation helper (supports 2+ keyframes)
export function interpolate(
  frame: number,
  inputRange: number[],
  outputRange: number[],
  options?: { clamp?: boolean }
): number {
  const clamp = options?.clamp ?? true;

  // Find the segment this frame falls into
  let i = inputRange.length - 2;
  for (let j = 0; j < inputRange.length - 1; j++) {
    if (frame < inputRange[j + 1]) {
      i = j;
      break;
    }
  }

  const inMin = inputRange[i];
  const inMax = inputRange[i + 1];
  const outMin = outputRange[i];
  const outMax = outputRange[i + 1];

  let t = (frame - inMin) / (inMax - inMin);
  if (clamp) t = Math.max(0, Math.min(1, t));

  return outMin + (outMax - outMin) * easeInOutCubic(t);
}

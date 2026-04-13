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

// === Dynamic Reveal Timing (multi-pair support) ===

export interface PairTiming {
  beforeStart: number;
  beforeEnd: number;
  transitionStart: number;
  transitionEnd: number;
  afterStart: number;
  afterEnd: number;
}

export interface DynamicRevealTiming {
  totalDuration: number;
  hookStart: number;
  hookEnd: number;
  pairs: PairTiming[];
  ctaStart: number;
  ctaEnd: number;
}

export function createRevealTiming(pairCount: number): DynamicRevealTiming {
  const fps = VIDEO.fps;
  const hookDuration = 3 * fps;          // 3s
  const beforeDuration = 3 * fps;        // 3s per pair
  const transitionDuration = 1.5 * fps;  // 1.5s
  const afterDuration = 3 * fps;         // 3s per pair
  const interPairBeat = 0.5 * fps;       // 0.5s gap between pairs
  const ctaDuration = 3.5 * fps;         // 3.5s

  const pairs: PairTiming[] = [];
  let cursor = hookDuration; // start after hook

  for (let i = 0; i < pairCount; i++) {
    const beforeStart = cursor;
    const beforeEnd = beforeStart + beforeDuration;
    const transitionStart = beforeEnd - Math.floor(0.5 * fps); // 0.5s overlap
    const transitionEnd = transitionStart + transitionDuration;
    const afterStart = transitionEnd - Math.floor(0.5 * fps);  // 0.5s overlap
    const afterEnd = afterStart + afterDuration;

    pairs.push({ beforeStart, beforeEnd, transitionStart, transitionEnd, afterStart, afterEnd });

    cursor = afterEnd;
    if (i < pairCount - 1) {
      cursor += interPairBeat;
    }
  }

  const ctaStart = cursor - Math.floor(0.5 * fps); // slight overlap with last after
  const ctaEnd = ctaStart + ctaDuration;

  return {
    totalDuration: ctaEnd,
    hookStart: 0,
    hookEnd: hookDuration,
    pairs,
    ctaStart,
    ctaEnd,
  };
}

// Backwards-compatible alias (single pair = original 15s-ish timing)
export const REVEAL_TIMING = createRevealTiming(1);

// === Dynamic Tips Timing (multi-tip support) ===

export interface TipTiming {
  tipStart: number;
  tipEnd: number;
}

export interface DynamicTipsTiming {
  totalDuration: number;
  hookStart: number;
  hookEnd: number;
  tips: TipTiming[];
  takeawayStart: number;
  takeawayEnd: number;
  ctaStart: number;
  ctaEnd: number;
}

export function createTipsTiming(tipCount: number): DynamicTipsTiming {
  const fps = VIDEO.fps;
  const hookDuration = 3 * fps;          // 3s
  const tipDuration = 8 * fps;           // 8s per tip
  const takeawayDuration = 3 * fps;      // 3s
  const ctaDuration = 3.5 * fps;         // 3.5s

  const tips: TipTiming[] = [];
  let cursor = hookDuration;

  for (let i = 0; i < tipCount; i++) {
    const tipStart = cursor - Math.floor(0.5 * fps); // 0.5s overlap with previous
    const tipEnd = tipStart + tipDuration;
    tips.push({ tipStart, tipEnd });
    cursor = tipEnd;
  }

  const takeawayStart = cursor - Math.floor(0.5 * fps);
  const takeawayEnd = takeawayStart + takeawayDuration;
  const ctaStart = takeawayEnd - Math.floor(0.5 * fps);
  const ctaEnd = ctaStart + ctaDuration;

  return {
    totalDuration: ctaEnd,
    hookStart: 0,
    hookEnd: hookDuration,
    tips,
    takeawayStart,
    takeawayEnd,
    ctaStart,
    ctaEnd,
  };
}

// Backwards-compatible alias (single tip = original ~15s timing)
export const TIPS_TIMING = createTipsTiming(1);

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

// Type declarations for ai-suggestions.js (plain ESM shared by browser + tests).
export const REVEAL_THEMES: string[];
export const REVEAL_DAMAGES: string[];
export const TIP_TOPICS: string[];
export function pickDistinct(
  pool: string[],
  current?: string | null,
  rng?: () => number
): string | undefined;
export function suggestRevealInputs(
  prev?: { hint?: string; damageNotes?: string },
  rng?: () => number
): { hint: string; damageNotes: string };
export function suggestTipInputs(
  prev?: { hint?: string },
  rng?: () => number
): { hint: string };

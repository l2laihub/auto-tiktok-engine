// Curated suggestion pools + pure pickers for the dashboard's "Generate with
// AI" panels. Plain ESM (no build step) so the browser (served at
// /static/ai-suggestions.js) and node/tsx tests import the same file. rng is
// injectable so tests are deterministic; it defaults to Math.random.

export const REVEAL_THEMES = [
  '1960s Saigon wedding portrait',
  'WWII-era soldier’s farewell photo',
  '1950s family on a front porch',
  'immigrants arriving by ship, 1920s',
  'grandparents’ 50th anniversary, 1970s',
  'a child’s first day of school, 1980s',
  'a Vietnamese-American family’s first Tet in the US',
  'fishermen on a rural coast, 1940s',
  'a couple dancing at a 1960s wedding',
  'three generations on a farm, 1930s',
  'a young woman in graduation robes, 1970s',
  'a corner-shop owner outside his store, 1950s',
  'siblings at a county fair, 1960s',
  'a newborn’s first portrait, 1980s',
  'a market street in Hanoi, 1950s',
  'a military reunion, late 1960s',
  'a beachside summer holiday, 1970s',
  'a church choir group photo, 1940s',
  'a father and son fishing, 1960s',
  'a debutante ball portrait, 1950s',
];

export const REVEAL_DAMAGES = [
  'deep water stains and faded edges, one torn corner',
  'heavy mildew spotting and yellowing',
  'cracked emulsion with white fold lines',
  'severe sun-fading, washed-out colors',
  'missing corner, scratches across the face',
  'sepia toning with mold blooms',
  'creased and dog-eared, dust scratches',
  'silvering and oxidation on a glossy print',
  'ink stains and a torn top edge',
  'brittle, curled, with surface cracks',
  'light leaks and chemical blotches',
  'fingerprint smudges and deep scuffs',
  'tape residue and discoloration',
  'warped from humidity, blurred soft focus',
  'fire-singed edges and soot marks',
];

export const TIP_TOPICS = [
  'scanning old prints with your phone',
  'storing negatives safely',
  'why AI faces can look wrong in restorations',
  'organizing decades of family photos',
  'rescuing water-damaged prints',
  'colorizing black-and-white photos',
  'backing up scanned memories',
  'lighting tips for re-photographing prints',
  'labeling photos so stories survive',
  'removing scratches without losing detail',
  'choosing what to restore first',
  'sharing restored photos with family',
  'preserving Polaroids over time',
  'digitizing slides and film reels',
  'fixing faded colors realistically',
  'protecting prints from humidity',
  'restoring torn or missing corners',
  'making prints from restored scans',
  'capturing the story behind each photo',
  'caring for heirloom albums',
];

// Random element of `pool` not equal to `current`. Single-element pool (or no
// non-current candidate) returns an element; empty pool returns undefined.
export function pickDistinct(pool, current, rng = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const candidates = current == null ? pool : pool.filter((x) => x !== current);
  const list = candidates.length ? candidates : pool;
  return list[Math.floor(rng() * list.length)];
}

// { hint, damageNotes } drawn independently from the two reveal pools,
// each excluding the matching previous value.
export function suggestRevealInputs(prev = {}, rng = Math.random) {
  return {
    hint: pickDistinct(REVEAL_THEMES, prev.hint, rng),
    damageNotes: pickDistinct(REVEAL_DAMAGES, prev.damageNotes, rng),
  };
}

// { hint } drawn from TIP_TOPICS, excluding the previous value.
export function suggestTipInputs(prev = {}, rng = Math.random) {
  return { hint: pickDistinct(TIP_TOPICS, prev.hint, rng) };
}

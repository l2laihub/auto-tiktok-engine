// ============================================================
// Caption Framing — picks a truthful voice for reveal captions.
//
// Reveal photos are AI-invented demos, not the poster's own family,
// so captions must never claim personal ownership. To keep the feed
// from feeling same-y, each reveal script is generated under one of
// three framings, chosen by weighted-random selection in code (each
// Claude call is stateless and can't vary itself across videos).
// Pure module — no I/O — so it is unit-testable.
// ============================================================

export type CaptionFraming = 'third_person' | 'capability' | 'invitation';

interface FramingDef {
  framing: CaptionFraming;
  weight: number; // selection probability; the weights below sum to 1.0
  instruction: string; // snippet injected into the reveal user prompt
}

// Ordered by descending weight. pickFraming walks this list accumulating
// weight, so order + weights together define the selection boundaries.
const FRAMINGS: FramingDef[] = [
  {
    framing: 'third_person',
    weight: 0.4,
    instruction:
      'Framing: THIRD-PERSON STORY. Tell the photo\'s story honestly in the third person — describe the people and the moment as someone else\'s history, never as your own. No "my"/"I" ownership ("my grandmother", "I found this"). Example hook: "Water-damaged for 60 years. Not anymore."',
  },
  {
    framing: 'capability',
    weight: 0.35,
    instruction:
      'Framing: APP CAPABILITY DEMO. Showcase what EternalFrame\'s AI does with an old, damaged photo — product-forward, factual, no personal ownership. Example hook: "Old photo → restored by AI in seconds".',
  },
  {
    framing: 'invitation',
    weight: 0.25,
    instruction:
      'Framing: VIEWER INVITATION. Speak to the viewer about THEIR own old photos and what AI restoration could do for them. Example hook: "Got photos like this in a drawer?"',
  },
];

/**
 * Weighted-random framing selection. `rng` is injectable so tests can pin
 * the result; defaults to Math.random in production.
 */
export function pickFraming(rng: () => number = Math.random): CaptionFraming {
  const r = rng();
  let cumulative = 0;
  for (const def of FRAMINGS) {
    cumulative += def.weight;
    if (r < cumulative) return def.framing;
  }
  // Fallback for r === 1 or float drift: return the last framing.
  return FRAMINGS[FRAMINGS.length - 1].framing;
}

/** The prompt snippet describing how to write in the chosen framing. */
export function framingInstruction(framing: CaptionFraming): string {
  const def = FRAMINGS.find((d) => d.framing === framing);
  if (!def) throw new Error(`Unknown caption framing: ${framing}`);
  return def.instruction;
}

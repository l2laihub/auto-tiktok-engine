// ============================================================
// Pure text helpers for reveal per-pair captions.
// No side effects, no network — safe to import from both the
// Node pipeline and Remotion components (the bundler).
// ============================================================

export interface PairCaptionInput {
  label?: string;
  era?: string;
  location?: string;
  story?: string;
  damage_notes?: string;
}

export interface PairCaption {
  before: string;
  after: string;
}

/** Max characters for a single on-screen caption line. */
export const CAPTION_MAX = 40;

/** Collapse whitespace, trim, and hard-cap a caption to `max` chars. */
export function clampCaption(text: string, max = CAPTION_MAX): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Small factual line shown under the "after" caption, e.g.
 * "Grandma's wedding · Saigon, 1962". Missing parts are dropped cleanly.
 */
export function buildFactualLine(opts: { label?: string; location?: string; era?: string }): string {
  const label = (opts.label || '').trim();
  const place = [opts.location, opts.era].map((s) => (s || '').trim()).filter(Boolean).join(', ');
  if (label && place) return `${label} · ${place}`;
  return label || place;
}

// NOTE: the "Max 40 characters" wording below must stay in sync with CAPTION_MAX.
export const PAIR_CAPTION_SYSTEM_PROMPT = `You are a TikTok copywriter for EternalFrame, an AI photo restoration app. For each old family photo you write a TWO-BEAT caption that plays over a before→after reveal.

Voice: warm, personal, nostalgic, emotionally direct. Never salesy, never clickbait — the words "you won't believe", "amazing", "shocking", "incredible" are banned.

For each photo write:
- "before": a SETUP line shown over the DAMAGED original. Name the loss or damage emotionally. Max 40 characters. No dates. Example: "Found water-damaged in a shoebox".
- "after": the PAYOFF line shown over the RESTORED photo. Emotional and intimate. Max 40 characters. Example: "Her smile, alive again".

Respond ONLY with a valid JSON array, one object per photo IN ORDER, each {"before": string, "after": string}.`;

/** Build the user prompt describing every pair's context, in order. */
export function buildPairCaptionPrompt(pairs: PairCaptionInput[]): string {
  const blocks = pairs
    .map((p, i) =>
      [
        `Photo ${i + 1}:`,
        `- Subject/label: ${p.label || 'an old family photo'}`,
        p.era ? `- Era: ${p.era}` : null,
        p.location ? `- Location: ${p.location}` : null,
        p.story ? `- Story: ${p.story}` : null,
        p.damage_notes ? `- Damage: ${p.damage_notes}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
  return `Write two-beat captions for these ${pairs.length} photo(s). Return a JSON array of exactly ${pairs.length} object(s), in order.\n\n${blocks}`;
}

/** Parse Claude's JSON array into exactly `pairCount` clamped captions. */
export function parsePairCaptions(raw: string, pairCount: number): PairCaption[] {
  const clean = raw.replace(/```json\s*|```\s*/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('Pair caption generation returned invalid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Pair caption generation did not return a JSON array');
  }
  const out: PairCaption[] = [];
  for (let i = 0; i < pairCount; i++) {
    const item = (parsed[i] || {}) as { before?: unknown; after?: unknown };
    out.push({
      before: clampCaption(typeof item.before === 'string' ? item.before : ''),
      after: clampCaption(typeof item.after === 'string' ? item.after : ''),
    });
  }
  return out;
}

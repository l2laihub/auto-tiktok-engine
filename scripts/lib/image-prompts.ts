// ============================================================
// Image-generation prompt builders (pure functions).
// Kept separate from the API wrapper so they're easy to tune/test.
// ============================================================

export interface PhotoSubject {
  /** Who/what is in the photo, e.g. "a young couple on their wedding day". */
  subject: string;
  /** Decade, e.g. "1960s". */
  era: string;
  /** 1-2 sentence emotional/contextual backstory (used for the script + DB). */
  story: string;
  /** Short caption shown on the reveal, e.g. "Grandma's wedding". */
  label: string;
}

/**
 * Prompt for the DAMAGED "before" image (text-to-image).
 * Defaults to DRAMATIC, unmistakable deterioration so the before→after
 * reveal lands hard. `damageNotes` lets a caller steer specifics
 * (e.g. "water-damaged 1960s Polaroid, mildew").
 */
export function buildBeforePrompt(s: PhotoSubject, damageNotes?: string): string {
  const base = [
    `A vertical 9:16 portrait-orientation photograph of ${s.subject}, taken in the ${s.era}.`,
    `Render it as a SEVERELY aged and DAMAGED vintage family photograph with dramatic, unmistakable physical deterioration:`,
    `deep tears and rips across the surface, one or more torn or completely missing corners,`,
    `large water stains and moisture blooms, deep creases and fold lines with cracked and flaking emulsion along them,`,
    `heavy fading and strong yellow/sepia discoloration, brittle silver-mirroring, foxing and brown mold spots,`,
    `scattered dust, scratches and white emulsion loss, frayed and curling edges.`,
    `The damage must be heavy and obvious — clearly a precious photo in urgent need of restoration —`,
    `while keeping the underlying subjects, faces and composition still recognizable beneath the damage.`,
    `Use authentic period clothing, hairstyles, furniture and setting for the ${s.era}.`,
    `It must look like a real scanned print from an old family photo album — not a modern or AI-looking photo.`,
    `Natural candid composition. No text, no captions, no watermarks, no borders.`,
  ].join(' ');
  return damageNotes
    ? `${base} Additional damage/style direction: ${damageNotes}.`
    : base;
}

/**
 * Prompt for the RESTORED "after" image (image-to-image edit of the before).
 * Critically instructs the model to preserve identity/composition.
 */
export function buildRestoreEditPrompt(): string {
  return [
    `Restore and colorize this old photograph. Repair all scratches, tears, creases, dust and stains;`,
    `remove fading and discoloration; recover natural, lifelike colors and realistic skin tones; sharpen`,
    `and enhance detail and clarity to clean modern quality.`,
    `CRITICAL: keep the exact same people, faces, expressions, poses, clothing and composition — do not`,
    `change anyone's identity and do not add or remove people.`,
    `Output a vivid, fully restored vertical 9:16 portrait photograph. No text, no watermarks.`,
  ].join(' ');
}

/**
 * Prompt for a tip background / b-roll image (text-to-image).
 * `variant` lets callers nudge multiple distinct images for the same tip.
 */
export function buildTipImagePrompt(
  tipTitle: string,
  tipBody: string,
  variant = 0
): string {
  const angles = [
    'a wide establishing shot',
    'a close-up detail shot',
    'an over-the-shoulder perspective',
  ];
  const angle = angles[variant % angles.length];
  return [
    `A cinematic, photorealistic vertical 9:16 image (${angle}) that visually illustrates this`,
    `photo-restoration concept: "${tipTitle}".`,
    `Context: ${tipBody}.`,
    `Warm, nostalgic archival tones, soft depth of field, gentle film grain. Tasteful and uncluttered so`,
    `it reads well as a darkened background behind on-screen text. No text, no words, no letters, no`,
    `watermarks, no UI elements.`,
  ].join(' ');
}

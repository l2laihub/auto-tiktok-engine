#!/usr/bin/env tsx
// ============================================================
// Generate Reveal Photos — self-source before/after content.
//
// Instead of requiring user-uploaded old photos, this invents a
// plausible family-photo scenario, generates a DAMAGED "before"
// image, then image-edits it into a RESTORED "after" (same subject),
// uploads both to Supabase Storage, and creates a queued `reveal`
// content item the normal pipeline can render & post.
// ============================================================
// Usage:
//   npm run generate:photos                       # 1 pair, auto subject
//   npm run generate:photos -- --pairs 3          # 3 pairs in one video
//   npm run generate:photos -- --hint "Vietnamese wedding photos"
//   npm run generate:photos -- --subject "a soldier and his bride" --era 1940s
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { generateImage, type GeneratedImage } from '../src/utils/image-gen';
import { uploadImageBuffer } from '../src/utils/storage';
import {
  buildBeforePrompt,
  buildRestoreEditPrompt,
  type PhotoSubject,
} from './lib/image-prompts';
import { generateScript } from './generate-script';

const anthropic = new Anthropic();

const SUBJECT_SYSTEM_PROMPT = `You invent realistic old family-photo scenarios for EternalFrame, an AI photo restoration app. Each scenario describes a single old photograph that someone might restore.

Guidance:
- Warm, personal, nostalgic — these are real-feeling family memories, not stock concepts.
- Vary eras across the 1920s–1990s. Vietnamese-American families are a key audience; include them sometimes, but keep variety (weddings, military service, immigrants arriving, grandparents, children, family portraits, shop owners, etc.).
- "subject" must be a concrete visual description of who is in the photo and what they're doing.
- "story" is 1–2 warm sentences of context/emotion.
- "label" is a short 2–4 word caption (e.g. "Grandma's wedding", "Dad in Saigon").
- "location" is a concrete place the photo was taken (city/region/country), e.g. "Saigon", "rural Texas", "Hanoi".

Respond ONLY with valid JSON: an array of objects, each {"subject","era","story","label","location"}.`;

/** Invent N distinct photo scenarios via Claude. */
export async function inventSubjects(count: number, hint?: string): Promise<PhotoSubject[]> {
  const userPrompt = `Generate ${count} distinct old-family-photo scenario${count > 1 ? 's' : ''}${
    hint ? `, themed around: ${hint}` : ''
  }. Return a JSON array of exactly ${count} object(s).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    system: SUBJECT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const clean = text.replace(/```json\s*|```\s*/g, '').trim();
  let parsed: PhotoSubject[];
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error('Failed to parse subject JSON. Raw output:\n', clean);
    throw new Error('Subject generation returned invalid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Subject generation returned no scenarios');
  }
  return parsed.slice(0, count);
}

export interface GeneratedPair {
  before_url: string;
  after_url: string;
  era: string;
  label: string;
  /** Concrete place the photo was taken, used for the factual caption line. */
  location?: string;
  /** Visual subject description used to (re)generate the before image. */
  subject?: string;
  /** 1–2 sentence backstory (kept for script generation + re-rolls). */
  story?: string;
  /** Free-text damage steering applied to the before image, if any. */
  damage_notes?: string;
}

/** Generate just the DAMAGED "before" image for a subject. */
export async function generateBeforeImage(
  subject: PhotoSubject,
  damageNotes?: string
): Promise<GeneratedImage> {
  return generateImage({ prompt: buildBeforePrompt(subject, damageNotes), aspectRatio: '9:16' });
}

/** Restore a "before" image into its "after" (image-to-image edit, same subject). */
export async function generateAfterFromBuffer(before: GeneratedImage): Promise<GeneratedImage> {
  return generateImage({
    prompt: buildRestoreEditPrompt(),
    referenceImage: { buffer: before.imageBuffer, mimeType: before.mimeType },
    aspectRatio: '9:16',
  });
}

/** Download an already-uploaded image (e.g. a stored before_url) into a buffer. */
export async function fetchImageAsGenerated(url: string): Promise<GeneratedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: HTTP ${res.status}`);
  const mimeType = res.headers.get('content-type') || 'image/png';
  const imageBuffer = Buffer.from(await res.arrayBuffer());
  return { imageBuffer, mimeType };
}

/** Generate a single damaged→restored pair and upload both images. */
export async function generatePair(subject: PhotoSubject, damageNotes?: string): Promise<GeneratedPair> {
  console.log(`  • ${subject.label} (${subject.era}) — ${subject.subject}`);

  // 1. Damaged "before"
  console.log('    generating damaged "before"...');
  const before = await generateBeforeImage(subject, damageNotes);
  const before_url = await uploadImageBuffer({
    buffer: before.imageBuffer,
    contentType: before.mimeType,
    pathPrefix: 'generated/reveal',
  });

  // 2. Restored "after" — edit the before so the subject stays identical
  console.log('    restoring → "after"...');
  const after = await generateAfterFromBuffer(before);
  const after_url = await uploadImageBuffer({
    buffer: after.imageBuffer,
    contentType: after.mimeType,
    pathPrefix: 'generated/reveal',
  });

  return {
    before_url,
    after_url,
    era: subject.era,
    label: subject.label,
    location: subject.location,
    subject: subject.subject,
    story: subject.story,
    damage_notes: damageNotes,
  };
}

export interface GenerateRevealOptions {
  pairs?: number;
  hint?: string;
  subjects?: PhotoSubject[];
  damageNotes?: string;
  source?: 'curated' | 'ai' | 'manual';
}

export interface GenerateRevealResult {
  contentId: string;
  imagePairs: GeneratedPair[];
  subjects: PhotoSubject[];
}

/**
 * Full flow: invent subjects (unless provided), generate all pairs, and
 * insert a queued `reveal` content item. Returns the new content id.
 */
export async function generateRevealPhotos(opts: GenerateRevealOptions = {}): Promise<GenerateRevealResult> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const count = Math.max(1, Math.min(6, opts.pairs ?? 1)); // schema allows 1–6
  const subjects = opts.subjects?.length ? opts.subjects.slice(0, count) : await inventSubjects(count, opts.hint);

  const imagePairs: GeneratedPair[] = [];
  for (const subject of subjects) {
    imagePairs.push(await generatePair(subject, opts.damageNotes));
  }

  const first = subjects[0];

  // Base row: an unscripted queued item (the original behavior, kept as the
  // fallback if script generation fails below).
  const insertRow: Record<string, unknown> = {
    content_type: 'reveal',
    status: 'queued',
    image_pairs: imagePairs,
    photo_era: first.era,
    photo_story: first.story,
    preset_used: 'full-enhancement',
    generation_meta: {
      hint: opts.hint ?? null,
      damageNotes: opts.damageNotes ?? null,
      source: opts.source ?? null,
    },
  };

  // Generate the script now so the item lands in the dashboard already
  // scripted (hook/caption reviewable before render). Same ContentItem shape
  // that render-video.ts ensureScript() uses, so "Regen Script" reproduces it.
  // On failure we keep the queued row — ensureScript() backfills at render.
  try {
    console.log('  Generating AI script...');
    const script = await generateScript({
      id: 'pending',
      content_type: 'reveal',
      photo_era: first.era,
      photo_story: first.story,
      preset_used: 'full-enhancement',
      pair_count: imagePairs.length,
      photo_stories: imagePairs.map((p, i) => `Pair ${i + 1}: ${p.era || 'unknown era'}`),
    });
    Object.assign(insertRow, {
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      music_track: script.music_mood,
      music_style: script.music_style,
      slogan: script.slogan,
      status: 'scripted',
    });
  } catch (err) {
    console.warn(
      `  ⚠️  Script generation failed, leaving item queued: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert content item: ${error.message}`);

  return { contentId: data.id, imagePairs, subjects };
}

// CLI entry point
async function main() {
  const argv = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const pairs = parseInt(getFlag('pairs') || '1', 10);
  const hint = getFlag('hint');
  const damageNotes = getFlag('damage');
  const subjectArg = getFlag('subject');
  const eraArg = getFlag('era');

  let subjects: PhotoSubject[] | undefined;
  if (subjectArg) {
    subjects = [{
      subject: subjectArg,
      era: eraArg || '1960s',
      story: `An old family photograph: ${subjectArg}.`,
      label: subjectArg.split(' ').slice(0, 3).join(' '),
    }];
  }

  console.log('🖼️  Generating reveal photos...');
  console.log(`  pairs: ${pairs}${hint ? `, hint: "${hint}"` : ''}${subjectArg ? `, subject: "${subjectArg}"` : ''}\n`);

  const result = await generateRevealPhotos({ pairs, hint, subjects, damageNotes });

  console.log(`\n✅ Created reveal item ${result.contentId} with ${result.imagePairs.length} pair(s).`);
  result.imagePairs.forEach((p, i) => {
    console.log(`  Pair ${i + 1}: ${p.label}`);
    console.log(`    before: ${p.before_url}`);
    console.log(`    after:  ${p.after_url}`);
  });
  console.log(`\nNext: npm run pipeline -- ${result.contentId}   (or pipeline:dry to render without posting)`);
}

const isDirectRun = process.argv[1]?.includes('generate-reveal-photos');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Reveal photo generation failed:', err);
    process.exit(1);
  });
}

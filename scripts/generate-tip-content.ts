#!/usr/bin/env tsx
// ============================================================
// Generate Tip Content — self-source a multi-tip educational item.
//
// Claude invents a tips topic + 4–6 tips (text + emoji icon), then we
// generate a background image per tip and insert a queued `tip` content
// item with the `tips` JSONB array. The first tip is mirrored into the
// legacy single-tip columns for backwards compatibility.
// ============================================================
// Usage:
//   npm run generate:tip-content
//   npm run generate:tip-content -- --count 5 --hint "iPhone photo scanning tips"
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { generateTipImages } from './generate-tip-images';
import { generateScript } from './generate-script';

const anthropic = new Anthropic();

export interface GeneratedTip {
  tipTitle: string;
  tipBody: string;
  tipIcon?: string;
  tipImageSrc?: string;
  tipImages?: string[];
}

const TIPS_SYSTEM_PROMPT = `You write punchy, genuinely useful tips/educational content for EternalFrame, an AI photo restoration & memory-keeping app, formatted for short vertical video.

Guidance:
- Each tip is specific, practical and scannable. No fluff.
- "tipTitle" is a short headline (max ~50 chars).
- "tipBody" is one or two tight sentences (max ~140 chars).
- "tipIcon" is a single emoji that fits the tip (e.g. 🖼️ 📸 ✨ 🔍 🎨).

Respond ONLY with valid JSON: an array of objects, each {"tipTitle","tipBody","tipIcon"}.`;

/** Invent N distinct tips via Claude. */
export async function inventTips(count: number, hint?: string): Promise<GeneratedTip[]> {
  const userPrompt = `Generate ${count} distinct photo-restoration / memory-keeping tip${count > 1 ? 's' : ''}${
    hint ? `, themed around: ${hint}` : ''
  }. Return a JSON array of exactly ${count} object(s).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: TIPS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const clean = text.replace(/```json\s*|```\s*/g, '').trim();
  let parsed: GeneratedTip[];
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error('Failed to parse tips JSON. Raw output:\n', clean);
    throw new Error('Tip generation returned invalid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Tip generation returned no tips');
  }
  return parsed.slice(0, count);
}

export interface GenerateTipContentOptions {
  count?: number;
  hint?: string;
  source?: 'curated' | 'ai' | 'manual';
}

export interface GenerateTipContentResult {
  contentId: string;
  tips: GeneratedTip[];
}

/** Invent tips, generate one background image each, and insert a queued tip item. */
export async function generateTipContent(opts: GenerateTipContentOptions = {}): Promise<GenerateTipContentResult> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const count = Math.max(1, Math.min(6, opts.count ?? 4));
  const tips = await inventTips(count, opts.hint);

  // One background image per tip (brollCount 0 => only the primary background).
  for (const tip of tips) {
    console.log(`  • ${tip.tipIcon || ''} ${tip.tipTitle}`);
    const { tipImageUrl, tipImages } = await generateTipImages(tip.tipTitle, tip.tipBody, 0);
    tip.tipImageSrc = tipImageUrl;
    tip.tipImages = tipImages;
  }

  const first = tips[0];

  // Base row: an unscripted queued item (original behavior, kept as fallback).
  const insertRow: Record<string, unknown> = {
    content_type: 'tip',
    status: 'queued',
    tips,
    // Mirror the first tip into legacy columns for back-compat.
    tip_title: first.tipTitle,
    tip_body: first.tipBody,
    tip_icon: first.tipIcon ?? null,
    tip_image_url: first.tipImageSrc ?? null,
    tip_images: first.tipImages ?? null,
    generation_meta: {
      hint: opts.hint ?? null,
      damageNotes: null,
      source: opts.source ?? null,
    },
  };

  // Script the item at creation so hook/caption are reviewable before render.
  // Tips keep their educational voice (no framing). On failure we keep the
  // queued row — ensureScript() backfills at render time.
  try {
    console.log('  Generating AI script...');
    const script = await generateScript({
      id: 'pending',
      content_type: 'tip',
      tip_title: first.tipTitle,
      tip_body: first.tipBody,
    });
    Object.assign(insertRow, {
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      music_track: script.music_mood,
      music_style: script.music_style,
      slogan: script.slogan,
      tip_icon: script.tip_icon ?? first.tipIcon ?? null,
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

  if (error) throw new Error(`Failed to insert tip item: ${error.message}`);
  return { contentId: data.id, tips };
}

// CLI entry point
async function main() {
  const argv = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const count = parseInt(getFlag('count') || '4', 10);
  const hint = getFlag('hint');

  console.log(`💡 Generating ${count} tip(s)${hint ? ` themed "${hint}"` : ''}...`);
  const result = await generateTipContent({ count, hint });
  console.log(`\n✅ Created tip item ${result.contentId} with ${result.tips.length} tip(s).`);
  console.log(`\nNext: npm run pipeline -- ${result.contentId}   (or pipeline:dry)`);
}

const isDirectRun = process.argv[1]?.includes('generate-tip-content');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Tip content generation failed:', err);
    process.exit(1);
  });
}

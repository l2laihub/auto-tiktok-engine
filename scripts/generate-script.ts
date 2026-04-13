// ============================================================
// Script Generation — Uses Claude API to generate TikTok scripts
// from content pool metadata.
// ============================================================
// Usage: npx tsx scripts/generate-script.ts <content-id>
// Or import generateScript() for use in n8n/Edge Functions.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic();

// Input from content pool
export interface ContentItem {
  id: string;
  content_type: 'reveal' | 'tip';
  // Reveal fields
  photo_era?: string;
  photo_story?: string;
  preset_used?: string;
  // Multi-pair fields
  pair_count?: number;
  photo_stories?: string[];
  // Tip fields
  tip_title?: string;
  tip_body?: string;
  tip_source?: string;
}

// AI-generated output
export interface GeneratedScript {
  hook_text: string;      // 1-2 lines, max 60 chars total
  caption: string;        // TikTok caption, 150-300 chars
  hashtags: string[];     // 5-8 relevant hashtags
  music_mood: string;     // mood for music matching: emotional | nostalgic | inspiring | upbeat
  music_style: string;    // Suno AI prompt: instruments, mood, tempo description
  slogan: string;         // 3-7 word emotional tagline for the CTA screen
  // Tip-specific extras
  takeaway?: string;      // one-liner key insight
}

const SYSTEM_PROMPT = `You are a TikTok content writer for EternalFrame, an AI photo restoration and colorization iOS app. Your job is to generate short-form video scripts that are emotionally compelling and drive app downloads.

Brand voice: Warm, nostalgic, personal. Never salesy. The emotion is in the transformation — old, faded, damaged photos becoming vivid family memories.

Target audience: Adults 30-65 who have old family photos. Vietnamese-American community is a key segment.

Rules:
- Hook text: MAX 60 characters total. Must stop the scroll in 1-2 seconds. Use emotional triggers: curiosity, nostalgia, surprise.
- Caption: 150-300 characters. Tell a micro-story. End with a soft CTA or question to drive comments.
- Hashtags: 5-8 relevant ones. Mix broad (#photorestoration) with niche (#familymemories #oldphotos).
- Never use generic phrases like "you won't believe" or "amazing results".
- Reference specific decades, family relationships, cultural moments when possible.

For videos with multiple before/after pairs, the hook should set up anticipation for a series of transformations (e.g. "3 forgotten photos, 3 incredible transformations").

Respond ONLY with valid JSON matching this schema:
{
  "hook_text": "string (max 60 chars, use \\n for line break)",
  "caption": "string (150-300 chars)",
  "hashtags": ["string"],
  "music_mood": "emotional | nostalgic | inspiring | upbeat",
  "music_style": "string (Suno AI prompt: describe instrumental background music — mood, instruments, tempo. Example: 'warm nostalgic piano with gentle strings, slow tempo, cinematic, emotional')",
  "slogan": "string (3-7 word emotional tagline for the end CTA screen. Should feel personal and warm. Examples: 'Honor them in every pixel.', 'Every photo tells their story.', 'Bring their smiles back to life.')",
  "takeaway": "string (optional, for tip content only)"
}`;

function buildUserPrompt(item: ContentItem): string {
  if (item.content_type === 'reveal') {
    const pairCount = item.pair_count || 1;
    const pairDetails = item.photo_stories?.length
      ? item.photo_stories.map((s, i) => `- Photo ${i + 1}: ${s}`).join('\n')
      : `- Era: ${item.photo_era || 'Unknown decade'}\n- Story/context: ${item.photo_story || 'Old family photo found in storage'}`;

    return `Generate a TikTok script for a BEFORE/AFTER photo reveal video.

This video showcases ${pairCount} before/after photo transformation${pairCount > 1 ? 's in sequence' : ''}.

Photo details:
${pairDetails}
- EternalFrame preset used: ${item.preset_used || 'photo-restoration'}

${pairCount > 1
  ? 'The video shows multiple damaged/faded photos being revealed as AI-restored versions in sequence. Build anticipation across the series — each reveal should feel like an emotional payoff.'
  : 'The video shows the damaged/faded original photo, then dramatically reveals the AI-restored version. The transformation should feel emotional and personal.'}`;
  }

  return `Generate a TikTok script for an EDUCATIONAL/TIPS video.

Tip details:
- Title: ${item.tip_title || 'Photo restoration tip'}
- Content: ${item.tip_body || 'General photo restoration advice'}
- Source: ${item.tip_source || 'EternalFrame autoresearch'}

The video presents a useful insight about photo restoration or AI image processing. Position EternalFrame as the expert. Include a "takeaway" field with a punchy one-liner.`;
}

export async function generateScript(item: ContentItem): Promise<GeneratedScript> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(item),
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => {
      if (block.type === 'text') return block.text;
      return '';
    })
    .join('');

  // Strip markdown fences if present
  const clean = text.replace(/```json\s*|```\s*/g, '').trim();

  let parsed: GeneratedScript;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error('Failed to parse Claude response as JSON. Raw output:');
    console.error(clean);
    throw new Error('Script generation returned invalid JSON');
  }

  // Validate hook length
  if (parsed.hook_text.replace(/\\n/g, '').length > 80) {
    console.warn('Hook text exceeds 80 chars, truncating...');
    parsed.hook_text = parsed.hook_text.substring(0, 77) + '...';
  }

  return parsed;
}

// CLI entry point
async function main() {
  const contentId = process.argv[2];

  if (!contentId) {
    // Demo mode with sample data
    console.log('No content ID provided. Running demo...\n');

    const demoReveal: ContentItem = {
      id: 'demo-reveal',
      content_type: 'reveal',
      photo_era: '1960s',
      photo_story: 'Wedding photo of Vietnamese grandparents, found in a water-damaged album',
      preset_used: 'vintage-colorize',
    };

    const demoTip: ContentItem = {
      id: 'demo-tip',
      content_type: 'tip',
      tip_title: 'Why AI faces look wrong in restored photos',
      tip_body: 'Most AI models distort facial features during restoration. After 100+ prompt iterations on face preservation, we found that explicit identity anchoring reduces face drift by 73%.',
      tip_source: 'EternalFrame autoresearch (100+ prompt iterations)',
    };

    console.log('=== Reveal Script ===');
    const revealScript = await generateScript(demoReveal);
    console.log(JSON.stringify(revealScript, null, 2));

    console.log('\n=== Tip Script ===');
    const tipScript = await generateScript(demoTip);
    console.log(JSON.stringify(tipScript, null, 2));

    return;
  }

  // Fetch from Supabase and generate
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`Fetching content ID: ${contentId}`);
  const { data: row, error: fetchError } = await supabase
    .from('tiktok_content_pool')
    .select('id, content_type, photo_era, photo_story, preset_used, tip_title, tip_body, tip_source')
    .eq('id', contentId)
    .single();

  if (fetchError || !row) {
    console.error(`Failed to fetch content: ${fetchError?.message || 'not found'}`);
    process.exit(1);
  }

  console.log(`Generating script for ${row.content_type} item...`);
  const script = await generateScript(row as ContentItem);
  console.log(JSON.stringify(script, null, 2));

  const { error: updateError } = await supabase
    .from('tiktok_content_pool')
    .update({
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      music_track: script.music_mood,
      music_style: script.music_style,
      slogan: script.slogan,
      status: 'scripted',
    })
    .eq('id', contentId);

  if (updateError) {
    console.error(`Failed to update row: ${updateError.message}`);
    process.exit(1);
  }

  console.log('Row updated to status: scripted');
}

// Only run CLI when executed directly (not when imported by render-video.ts)
const isDirectRun = process.argv[1]?.includes('generate-script');
if (isDirectRun) {
  main().catch(console.error);
}

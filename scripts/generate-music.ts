// ============================================================
// Generate one background track sized to a studio-ops props file.
//
// render-video.ts's generateAudio() does this for the content pool, but it is
// Supabase-coupled (ContentRow in, music_file_path row update out). studio-ops
// has a .video.json and no DB, so this reuses the pieces underneath: the same
// Lyria 3 call, the same ffmpeg trim, and the same timing functions Root.tsx
// feeds calculateMetadata — so the track can never drift from the video.
//
// Usage:
//   npm run generate:music -- <props.video.json> [options]
//     --prompt "<style>"   music style; persisted to the props as musicPrompt
//     --volume 0.8         audioVolume written to the props (default 0.8)
//     --force              regenerate even if the mp3 already exists
//     --dry-run            print duration/prompt/output path, call nothing
//     --self-test          run the duration assertions and exit
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { generateMusicTrack, trimAudioFile } from '../src/utils/lyria';
import { VIDEO, createRevealTiming, createTipsTiming, createShowcaseTiming } from '../src/config';
import { hookSecondsFor, takeawaySecondsFor } from '../src/compositions/TipsEducational';

// ponytail: 0.8, not the old 0.35. That 0.35 was picked against un-normalized
// tracks, where "too loud" meant one hot track — it cost 9.1 dB and left videos
// audibly quiet. Now that trimAudioFile normalizes every track to -14 LUFS, this
// is a real number: 0.8 lands the finished video near -16 LUFS. There is no
// voiceover to duck under, so the music is the whole soundtrack.
const DEFAULT_VOLUME = 0.8;
const DEFAULT_PROMPT =
  'warm upbeat instrumental, light acoustic guitar and soft percussion, ' +
  'friendly local-business mood, no vocals';

/**
 * Frames this props object will render for — the same three timing functions
 * Root.tsx calls in calculateMetadata, picked by which field the props carry.
 */
export function durationFramesFor(props: any): number {
  if (props?.imagePairs) return createRevealTiming(props.imagePairs.length || 1).totalDuration;
  if (props?.tips) {
    return createTipsTiming(
      props.tips.length || 1,
      hookSecondsFor(props),
      takeawaySecondsFor(props)
    ).totalDuration;
  }
  if (props?.images) return createShowcaseTiming(props.images.length || 1).totalDuration;
  throw new Error('props carry no imagePairs / tips / images — cannot tell which composition this is');
}

/**
 * `clients/nk-nails/content/assets/2026-08-post4.video.json`
 *   -> `nk-nails-2026-08-post4`, matching the rendered mp4's name.
 * Falls back to the bare stem for a props file kept somewhere else.
 */
export function trackNameFor(propsPath: string): string {
  const stem = path.basename(propsPath).replace(/\.video\.json$/, '').replace(/\.json$/, '');
  const parts = path.resolve(propsPath).split(path.sep);
  const contentAt = parts.lastIndexOf('content');
  const slug = contentAt > 0 ? parts[contentAt - 1] : '';
  return slug ? `${slug}-${stem}` : stem;
}

function selfTest() {
  const fps = VIDEO.fps;
  // Reveal and showcase grow with their item count.
  assert(durationFramesFor({ imagePairs: [1, 2] }) > durationFramesFor({ imagePairs: [1] }),
    'more pairs -> longer reveal');
  assert(durationFramesFor({ images: [1, 2, 3, 4, 5] }) > durationFramesFor({ images: [1, 2, 3, 4] }),
    'more photos -> longer showcase');
  // A wordier hook stretches the tips video (hookSecondsFor scales by word count).
  const short = durationFramesFor({ tips: [1, 2], hookText: 'Two words' });
  const long = durationFramesFor({ tips: [1, 2], hookText: 'A far longer hook that keeps on going for a while yet' });
  assert(long > short, 'wordier hook -> longer tips video');
  // Sanity: a 3-tip video lands in the ~30-60s band the templates are built for.
  const secs = durationFramesFor({ tips: [1, 2, 3], hookText: 'Whose photos are on your listing?' }) / fps;
  assert(secs > 25 && secs < 70, `3-tip video should be 25-70s, got ${secs.toFixed(1)}s`);
  // Props we cannot classify must fail loudly rather than generate 30s of nothing.
  let threw = false;
  try { durationFramesFor({ hookText: 'orphan' }); } catch { threw = true; }
  assert(threw, 'unclassifiable props must throw');
  assert(trackNameFor('clients/nk-nails/content/assets/2026-08-post4.video.json') === 'nk-nails-2026-08-post4',
    'track name carries the client slug');
  console.log('generate-music self-test: ok');
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`self-test failed: ${msg}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // Positional = the first arg that is neither a flag nor a flag's value.
  const takesValue = new Set(['--prompt', '--volume']);
  const propsPath = argv.find((a, i) => !a.startsWith('--') && !takesValue.has(argv[i - 1]));
  if (!propsPath) {
    console.error('Usage: npm run generate:music -- <props.video.json> [--prompt "..."] [--volume 0.35] [--force] [--dry-run]');
    process.exit(1);
  }
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');

  const abs = path.resolve(propsPath);
  const props = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const durationMs = Math.ceil((durationFramesFor(props) / VIDEO.fps) * 1000);
  const prompt = flag('--prompt') || props.musicPrompt || DEFAULT_PROMPT;
  const volume = Number(flag('--volume') ?? props.audioVolume ?? DEFAULT_VOLUME);

  const musicDir = path.resolve(__dirname, '../public/music');
  const name = trackNameFor(abs);
  const outputPath = path.join(musicDir, `${name}.mp3`);
  const musicFile = `music/${name}.mp3`;

  console.log(`  Video duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Prompt: "${prompt}"`);
  console.log(`  Output: ${outputPath}`);
  if (dryRun) return console.log('  --dry-run: nothing generated, props untouched.');

  if (fs.existsSync(outputPath) && !force) {
    console.log('  Track already exists — reusing it (--force to regenerate).');
  } else {
    fs.mkdirSync(musicDir, { recursive: true });
    // ponytail: Lyria returns an empty candidate often enough (roughly one call
    // in three) that a bare failure would just mean the operator re-runs by hand.
    let audioBuffer: Buffer | undefined;
    for (let attempt = 1; attempt <= 3 && !audioBuffer; attempt++) {
      try {
        ({ audioBuffer } = await generateMusicTrack({
          prompt,
          instrumental: true,
          title: name,
          durationSeconds: durationMs / 1000,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 3) throw err;
        console.warn(`  Attempt ${attempt} failed (${msg}) — retrying...`);
      }
    }
    if (!audioBuffer) throw new Error('Lyria 3 returned no audio after 3 attempts');
    // Lyria returns a whole clip; trim it to the video with a 3s fade-out so
    // the track ends rather than getting chopped mid-phrase by Remotion.
    const rawPath = outputPath.replace(/\.mp3$/, '.raw.mp3');
    fs.writeFileSync(rawPath, audioBuffer);
    try {
      trimAudioFile({ inputPath: rawPath, targetDurationMs: durationMs, outputPath });
    } finally {
      if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
    }
  }

  // Patch the props so the render picks the track up and a re-render reproduces
  // the same one — the .video.json is the durable recipe (studio-ops CLAUDE.md).
  props.musicFile = musicFile;
  props.audioVolume = volume;
  props.musicPrompt = prompt;
  fs.writeFileSync(abs, JSON.stringify(props, null, 2) + '\n');
  console.log(`  Props patched: musicFile=${musicFile}, audioVolume=${volume}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

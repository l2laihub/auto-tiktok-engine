// ============================================================
// Suno AI Music Generation Utility
// Uses gcui-art/suno-api (self-hosted REST server)
// ============================================================

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SUNO_API_URL = process.env.SUNO_API_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max

interface SunoTrack {
  id: string;
  status: string;
  audio_url: string;
  title: string;
  duration: number;
}

interface GenerateMusicOptions {
  prompt: string;         // Style/mood description for Suno
  instrumental?: boolean; // Default true — no vocals for background music
  title?: string;         // Track title
}

interface GeneratedTrack {
  id: string;
  audioUrl: string;
  title: string;
}

/**
 * Generate a background music track via Suno AI.
 * Calls the gcui-art/suno-api custom_generate endpoint.
 */
export async function generateMusicTrack(opts: GenerateMusicOptions): Promise<GeneratedTrack> {
  const { prompt, instrumental = true, title = 'Background Track' } = opts;

  const response = await fetch(`${SUNO_API_URL}/api/custom_generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      tags: prompt, // Suno uses tags for style descriptors
      title,
      make_instrumental: instrumental,
      wait_audio: false, // We'll poll ourselves
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Suno API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as SunoTrack[];

  if (!data || data.length === 0) {
    throw new Error('Suno API returned no tracks');
  }

  // Suno generates 2 tracks per request; pick the first
  const track = data[0];
  console.log(`  Suno: generation started, track ID: ${track.id}`);

  // Poll until ready
  const completed = await pollForCompletion([track.id]);
  const readyTrack = completed[0];

  return {
    id: readyTrack.id,
    audioUrl: readyTrack.audio_url,
    title: readyTrack.title,
  };
}

/**
 * Poll Suno API until track generation completes.
 */
async function pollForCompletion(ids: string[]): Promise<SunoTrack[]> {
  const idsParam = ids.join(',');

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(`${SUNO_API_URL}/api/get?ids=${idsParam}`);

    if (!response.ok) {
      console.warn(`  Suno poll attempt ${attempt + 1} failed: ${response.status}`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const tracks = await response.json() as SunoTrack[];
    const allReady = tracks.every(
      (t) => t.status === 'streaming' || t.status === 'complete'
    );

    if (allReady && tracks[0].audio_url) {
      console.log(`  Suno: track ready after ${(attempt + 1) * 5}s`);
      return tracks;
    }

    const statuses = tracks.map((t) => t.status).join(', ');
    console.log(`  Suno: polling... attempt ${attempt + 1}, status: ${statuses}`);
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Suno: track generation timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
}

/**
 * Download an MP3 from Suno CDN and trim to target duration with ffmpeg.
 * Adds a 3-second fade-out at the end.
 */
export async function downloadAndTrim(opts: {
  audioUrl: string;
  targetDurationMs: number;
  outputPath: string;
}): Promise<string> {
  const { audioUrl, targetDurationMs, outputPath } = opts;
  const targetSeconds = targetDurationMs / 1000;
  const fadeStart = Math.max(0, targetSeconds - 3);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Download the raw MP3
  const tempPath = outputPath.replace(/\.mp3$/, '.raw.mp3');
  const downloadResponse = await fetch(audioUrl);
  if (!downloadResponse.ok) {
    throw new Error(`Failed to download audio from ${audioUrl}: ${downloadResponse.status}`);
  }
  const buffer = Buffer.from(await downloadResponse.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);
  console.log(`  Suno: downloaded raw audio (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

  // Trim with ffmpeg and add fade-out
  const ffmpegCmd = [
    'ffmpeg', '-y',
    '-i', tempPath,
    '-t', targetSeconds.toFixed(1),
    '-af', `afade=t=out:st=${fadeStart.toFixed(1)}:d=3`,
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    outputPath,
  ].join(' ');

  try {
    execSync(ffmpegCmd, { stdio: 'pipe' });
    console.log(`  Suno: trimmed to ${targetSeconds}s with fade-out -> ${outputPath}`);
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }

  return outputPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

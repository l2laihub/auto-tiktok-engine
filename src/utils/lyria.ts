// ============================================================
// Google Lyria 3 Music Generation Utility
// Uses Gemini API with Lyria 3 Pro model (up to ~3 min)
// ============================================================

import { GoogleGenAI } from '@google/genai';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface GenerateMusicOptions {
  prompt: string;
  instrumental?: boolean; // Default true
  title?: string;
  durationSeconds?: number; // Target duration — included in prompt for Pro model
}

interface GeneratedAudio {
  audioBuffer: Buffer;
  mimeType: string;
}

/**
 * Generate a background music track via Google Lyria 3 Pro.
 * Pro model supports up to ~3 minutes; duration is guided via prompt.
 * ffmpeg trimming in the pipeline ensures exact length match.
 */
export async function generateMusicTrack(opts: GenerateMusicOptions): Promise<GeneratedAudio> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY not set. Get one from https://aistudio.google.com/app/apikey');
  }

  const { prompt, instrumental = true, title, durationSeconds } = opts;

  // Build the music prompt
  let musicPrompt = prompt;
  if (instrumental && !prompt.toLowerCase().includes('instrumental')) {
    musicPrompt += '. Instrumental.';
  }
  // Guide Pro model on target duration
  if (durationSeconds && durationSeconds > 30) {
    musicPrompt += ` Duration: approximately ${Math.ceil(durationSeconds)} seconds.`;
  }
  if (title) {
    musicPrompt = `Title: "${title}". ${musicPrompt}`;
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log(`  Lyria 3 Pro: generating music...`);
  console.log(`  Prompt: "${musicPrompt}"`);

  const response = await ai.models.generateContent({
    model: 'lyria-3-pro-preview',
    contents: musicPrompt,
    config: {
      responseModalities: ['AUDIO'],
    },
  });

  // Extract audio data from response
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Lyria 3: no candidates in response');
  }

  const parts = candidates[0].content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('Lyria 3: no content parts in response');
  }

  const audioPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('audio/'));
  if (!audioPart?.inlineData?.data) {
    throw new Error('Lyria 3: no audio data in response');
  }

  const audioBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
  console.log(`  Lyria 3: received ${(audioBuffer.length / 1024).toFixed(0)}KB audio`);

  return {
    audioBuffer,
    mimeType: audioPart.inlineData.mimeType || 'audio/mpeg',
  };
}

/**
 * Trim an audio file to target duration with a 3-second fade-out.
 * Reuses the same ffmpeg approach as Suno's downloadAndTrim.
 */
export function trimAudioFile(opts: {
  inputPath: string;
  targetDurationMs: number;
  outputPath: string;
}): string {
  const { inputPath, targetDurationMs, outputPath } = opts;
  const targetSeconds = targetDurationMs / 1000;
  const fadeStart = Math.max(0, targetSeconds - 3);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ffmpegCmd = [
    'ffmpeg', '-y',
    '-i', inputPath,
    '-t', targetSeconds.toFixed(1),
    '-af', `afade=t=out:st=${fadeStart.toFixed(1)}:d=3`,
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    outputPath,
  ].join(' ');

  execSync(ffmpegCmd, { stdio: 'pipe' });
  console.log(`  Lyria 3: trimmed to ${targetSeconds.toFixed(1)}s with fade-out -> ${outputPath}`);

  return outputPath;
}

// ============================================================
// Gemini Image Generation Utility (nano-banana)
// Uses the Gemini API (gemini-2.5-flash-image) via @google/genai.
// Supports text-to-image and image-to-image editing.
// Mirrors the structure of src/utils/lyria.ts (same SDK + key).
// ============================================================

import { GoogleGenAI } from '@google/genai';
import { withRetry } from '../../scripts/lib/retry';

// nano-banana. Image model naming has churned across previews; keep it a
// single constant so it's trivial to bump (e.g. to gemini-3-pro-image-preview).
const IMAGE_MODEL = 'gemini-2.5-flash-image';

export type AspectRatio = '9:16' | '1:1' | '3:4' | '4:3' | '16:9';

export interface GenerateImageOptions {
  prompt: string;
  /** When present, performs an image-to-image edit using this image as input. */
  referenceImage?: { buffer: Buffer; mimeType: string };
  /** Defaults to '9:16' to match the 1080x1920 TikTok video frame. */
  aspectRatio?: AspectRatio;
}

export interface GeneratedImage {
  imageBuffer: Buffer;
  mimeType: string;
}

/**
 * Generate (or edit) an image with Gemini nano-banana.
 * Returns the raw image bytes; callers handle upload/persistence.
 */
export async function generateImage(opts: GenerateImageOptions): Promise<GeneratedImage> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY not set. Get one from https://aistudio.google.com/app/apikey');
  }

  const { prompt, referenceImage, aspectRatio = '9:16' } = opts;
  const ai = new GoogleGenAI({ apiKey });

  // Build multimodal parts: reference image (if editing) first, then the instruction.
  const parts: Array<Record<string, unknown>> = [];
  if (referenceImage) {
    parts.push({
      inlineData: {
        mimeType: referenceImage.mimeType,
        data: referenceImage.buffer.toString('base64'),
      },
    });
  }
  parts.push({ text: prompt });

  const contents = [{ role: 'user', parts }];

  // Config support varies by model version: some reject the imageConfig block,
  // a few reject responseModalities entirely. Degrade gracefully through three
  // tiers (the aspect ratio is also requested in the prompt text as a hint).
  //   tier 0: responseModalities + imageConfig.aspectRatio
  //   tier 1: responseModalities only
  //   tier 2: no config (matches the SDK's minimal documented form)
  const callModel = async (tier: number) => {
    let config: Record<string, unknown> | undefined;
    if (tier === 0) config = { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } };
    else if (tier === 1) config = { responseModalities: ['IMAGE'] };
    else config = undefined;
    // Cast: imageConfig isn't in the installed SDK's typings yet.
    return ai.models.generateContent({ model: IMAGE_MODEL, contents, config } as never);
  };

  return withRetry(
    async () => {
      let response;
      try {
        response = await callModel(0);
      } catch {
        try {
          response = await callModel(1);
        } catch {
          response = await callModel(2);
        }
      }

      const candidates = response.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('image-gen: no candidates in response');
      }
      const respParts = candidates[0].content?.parts;
      if (!respParts || respParts.length === 0) {
        throw new Error('image-gen: no content parts in response');
      }

      const imagePart = respParts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart?.inlineData?.data) {
        // Models sometimes return a text refusal/explanation instead of an image.
        const txt = respParts.find((p: any) => p.text)?.text;
        throw new Error(
          `image-gen: no image in response${txt ? ` (model said: ${txt.slice(0, 200)})` : ''}`
        );
      }

      return {
        imageBuffer: Buffer.from(imagePart.inlineData.data, 'base64'),
        mimeType: imagePart.inlineData.mimeType || 'image/png',
      };
    },
    {
      maxRetries: 2,
      baseDelayMs: 2000,
      maxDelayMs: 15000,
      onAttempt: (attempt, err, delay) => {
        console.warn(`  image-gen retry ${attempt}: ${err.message} (waiting ${Math.round(delay)}ms)`);
      },
    }
  );
}

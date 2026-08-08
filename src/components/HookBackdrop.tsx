import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { interpolate } from '../config';

interface HookBackdropProps {
  /** Path relative to public/, or an http URL. */
  imageSrc?: string;
  /** First frame the image is on screen. 0 puts it in the thumbnail. */
  startFrame: number;
  /** Fade completes here — normally the hook's end, where tip imagery takes over. */
  endFrame: number;
}

/**
 * Full-bleed photo behind the opening of a video.
 *
 * ponytail: a separate layer, not baked into HookText — the caller decides
 * paint order. TipsEducational draws its slogan card and hook text on top of
 * this, so an AbsoluteFill living inside HookText would cover the slogan.
 * Starting it at frame 0 is what puts a photo in the thumbnail instead of a
 * bare gradient.
 */
export const HookBackdrop: React.FC<HookBackdropProps> = ({
  imageSrc,
  startFrame,
  endFrame,
}) => {
  const frame = useCurrentFrame();
  if (!imageSrc || frame < startFrame || frame > endFrame) return null;

  // No fade-in: frame 0 must be fully painted or the thumbnail is still blank.
  const fadeOut = interpolate(frame, [endFrame - 15, endFrame], [1, 0]);

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <Img
        src={imageSrc.startsWith('http') ? imageSrc : staticFile(imageSrc)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          // slow push-in, same language as TipCard's Ken Burns
          transform: `scale(${interpolate(frame, [startFrame, endFrame], [1.04, 1.14])})`,
        }}
      />
      {/* ponytail: light scrim. The slogan and hook both carry their own
          contrast (glass panel, textShadow) — this only takes the top off a
          bright photo. Darker and the photo stops being worth having. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(10,12,24,0.55) 0%, rgba(10,12,24,0.30) 45%, rgba(10,12,24,0.70) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

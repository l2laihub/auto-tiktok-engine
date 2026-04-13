import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  staticFile,
  Audio,
} from 'remotion';
import { BRAND, createRevealTiming, interpolate } from '../config';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';
import { RevealPair } from '../components/RevealPair';

// Per-pair image data
export interface ImagePair {
  beforeImageSrc: string;
  afterImageSrc: string;
  photoEra?: string;
  label?: string;
}

// Props passed from the render script / content pool
export interface RevealProps {
  hookText: string;
  // Legacy single-pair support (backwards compat)
  beforeImageSrc?: string;
  afterImageSrc?: string;
  photoEra?: string;
  // Multi-pair support
  imagePairs?: ImagePair[];
  // Audio
  musicFile?: string;
  audioVolume?: number;
  // CTA
  slogan?: string;
}

export const BeforeAfterReveal: React.FC<RevealProps> = ({
  hookText,
  beforeImageSrc,
  afterImageSrc,
  photoEra,
  imagePairs: imagePairsProp,
  musicFile,
  audioVolume = 0.6,
  slogan,
}) => {
  const frame = useCurrentFrame();

  // Normalize: use imagePairs if provided, else build from legacy props
  const pairs: ImagePair[] = imagePairsProp && imagePairsProp.length > 0
    ? imagePairsProp
    : [{
        beforeImageSrc: beforeImageSrc || '',
        afterImageSrc: afterImageSrc || '',
        photoEra,
      }];

  const timing = createRevealTiming(pairs.length);

  // Resolve audio source: URL or static file
  const audioSrc = musicFile
    ? musicFile.startsWith('http') ? musicFile : staticFile(musicFile)
    : undefined;

  // Hook background: show blurred first before-image during hook phase
  const hookBgOpacity = interpolate(
    frame,
    [timing.hookStart, timing.hookStart + 10, timing.pairs[0].beforeStart, timing.pairs[0].beforeStart + 15],
    [0, 1, 1, 0]
  );

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.dark }}>
      {/* Background music */}
      {audioSrc && <Audio src={audioSrc} volume={audioVolume} />}

      {/* === HOOK BACKGROUND: blurred first before-image === */}
      {pairs[0]?.beforeImageSrc && (
        <AbsoluteFill style={{ opacity: hookBgOpacity }}>
          <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            <Img
              src={pairs[0].beforeImageSrc}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(20px) saturate(0.5) brightness(0.35)',
                transform: 'scale(1.1)',
              }}
            />
          </div>
          {/* Dark vignette on top */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)',
            }}
          />
        </AbsoluteFill>
      )}

      {/* === REVEAL PAIRS === */}
      {pairs.map((pair, i) => (
        <RevealPair
          key={i}
          beforeImageSrc={pair.beforeImageSrc}
          afterImageSrc={pair.afterImageSrc}
          photoEra={pair.photoEra}
          pairTiming={timing.pairs[i]}
          pairIndex={i}
          totalPairs={pairs.length}
        />
      ))}

      {/* === HOOK TEXT === */}
      <HookText
        text={hookText}
        startFrame={timing.hookStart}
        endFrame={timing.hookEnd + 30}
        fontSize={54}
        position="center"
      />

      {/* === CTA === */}
      <EternalFrameCTA startFrame={timing.ctaStart} endFrame={timing.ctaEnd} slogan={slogan} />

      {/* === Bottom gradient (for TikTok UI safe area) === */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 180,
          background:
            'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

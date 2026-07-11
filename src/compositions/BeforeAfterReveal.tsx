import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  staticFile,
  Audio,
} from 'remotion';
import { VIDEO, createRevealTiming, interpolate } from '../config';
import { resolveBrand, BrandProvider, type BrandProps } from '../brand';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';
import { RevealPair } from '../components/RevealPair';

const { fontFamily: playfair } = loadPlayfair();

// Per-pair image data
export interface ImagePair {
  beforeImageSrc: string;
  afterImageSrc: string;
  photoEra?: string;
  label?: string;
  location?: string;
  captionBefore?: string;
  captionAfter?: string;
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
  // Per-client branding (defaults to EternalFrame)
  brand?: BrandProps;
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
  brand: brandProp,
}) => {
  const frame = useCurrentFrame();
  const brand = resolveBrand(brandProp);
  const BRAND = brand.colors;

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

  // Hook background: blurry split-screen before/after preview during hook phase
  const hookBgOpacity = interpolate(
    frame,
    [timing.hookStart, timing.hookStart + 10, timing.pairs[0].beforeStart, timing.pairs[0].beforeStart + 15],
    [1, 1, 1, 0]
  );

  // Divider line animation: subtle glow pulse
  const dividerGlow = 0.6 + 0.3 * Math.sin(frame * 0.1);

  // Slogan intro: visible at frame 0, fades out before hook text starts
  const sloganIntroDuration = Math.floor(1.5 * VIDEO.fps); // 1.5s
  const sloganOpacity = interpolate(
    frame,
    [0, 8, sloganIntroDuration - 12, sloganIntroDuration],
    [1, 1, 1, 0]
  );
  const sloganScale = interpolate(
    frame,
    [0, 10],
    [0.92, 1]
  );

  return (
    <BrandProvider value={brand}>
    <AbsoluteFill style={{ backgroundColor: BRAND.dark }}>
      {/* Background music */}
      {audioSrc && <Audio src={audioSrc} volume={audioVolume} />}

      {/* === HOOK BACKGROUND: blurry split-screen before/after preview === */}
      {pairs[0]?.beforeImageSrc && (
        <AbsoluteFill style={{ opacity: hookBgOpacity }}>
          {/* Left half: blurred before image */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '50%',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <Img
              src={pairs[0].beforeImageSrc}
              style={{
                width: '200%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(8px) saturate(0.5) brightness(0.55)',
                transform: 'scale(1.05)',
              }}
            />
          </div>

          {/* Right half: blurred after image */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '50%',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <Img
              src={pairs[0].afterImageSrc}
              style={{
                width: '200%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'right center',
                filter: 'blur(8px) brightness(0.65)',
                transform: 'scale(1.05)',
              }}
            />
          </div>

          {/* Center divider line */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 3,
              height: '100%',
              background: `linear-gradient(to bottom, transparent 5%, ${BRAND.coral} 30%, ${BRAND.amber} 70%, transparent 95%)`,
              opacity: dividerGlow,
              boxShadow: `0 0 20px ${BRAND.coral}60, 0 0 40px ${BRAND.coral}30`,
            }}
          />

          {/* Dark vignette on top */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)',
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
          label={pair.label}
          location={pair.location}
          captionBefore={pair.captionBefore}
          captionAfter={pair.captionAfter}
          pairTiming={timing.pairs[i]}
          pairIndex={i}
          totalPairs={pairs.length}
        />
      ))}

      {/* === SLOGAN INTRO (visible at frame 0 for thumbnail) === */}
      {frame < sloganIntroDuration && (
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: sloganOpacity,
            transform: `scale(${sloganScale})`,
          }}
        >
          <div
            style={{
              fontFamily: playfair,
              fontSize: 52,
              fontWeight: 700,
              fontStyle: 'italic',
              color: BRAND.amber,
              textAlign: 'center',
              paddingLeft: 60,
              paddingRight: 60,
              lineHeight: 1.35,
              textShadow: `0 4px 30px ${BRAND.dark}, 0 0 60px ${BRAND.dark}CC`,
            }}
          >
            {slogan || 'Honor them in every pixel.'}
          </div>
          <div
            style={{
              marginTop: 20,
              fontFamily: playfair,
              fontSize: 28,
              fontWeight: 400,
              color: BRAND.textLight,
              letterSpacing: 3,
              textTransform: 'uppercase',
              textShadow: `0 2px 20px ${BRAND.dark}`,
            }}
          >
            {brand.name}
          </div>
        </div>
      )}

      {/* === HOOK TEXT (delayed to start after slogan) === */}
      <HookText
        text={hookText}
        startFrame={sloganIntroDuration - 10}
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
    </BrandProvider>
  );
};

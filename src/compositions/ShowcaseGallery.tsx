import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  staticFile,
  Audio,
} from 'remotion';
import { SAFE_ZONE, createShowcaseTiming, interpolate } from '../config';
import { resolveBrand, BrandProvider, type BrandProps } from '../brand';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';

const { fontFamily: playfair } = loadPlayfair();

// Accept http(s) URLs or paths relative to public/
function resolveSrc(src: string): string {
  return src.startsWith('http') ? src : staticFile(src);
}

export interface ShowcaseImage {
  src: string;
  /** Optional caption chip, e.g. "Ombre Full Set · $75". Facts from the client profile only. */
  label?: string;
}

export interface ShowcaseProps {
  hookText: string;
  images: ShowcaseImage[];
  /** Teaser line under the hook card. */
  hookTeaser?: string;
  // Audio
  musicFile?: string;
  audioVolume?: number;
  // CTA
  slogan?: string;
  // Per-client branding (defaults to EternalFrame)
  brand?: BrandProps;
}

export const ShowcaseGallery: React.FC<ShowcaseProps> = ({
  hookText,
  images,
  hookTeaser = 'fresh from the studio',
  musicFile,
  audioVolume = 0.6,
  slogan,
  brand: brandProp,
}) => {
  const frame = useCurrentFrame();
  const brand = resolveBrand(brandProp);
  const BRAND = brand.colors;
  const timing = createShowcaseTiming(images.length);

  const audioSrc = musicFile
    ? musicFile.startsWith('http') ? musicFile : staticFile(musicFile)
    : undefined;

  // Hook background: blurred first photo, fading out as the sharp gallery starts
  const firstStart = timing.images[0].start;
  const hookBgOpacity = interpolate(
    frame,
    [0, 10, firstStart, firstStart + 18],
    [1, 1, 1, 0]
  );

  // Slogan intro: visible at frame 0 for the thumbnail, fades before the hook text
  const sloganIntroDuration = timing.hookEnd / 2; // 1.5s
  const sloganOpacity = interpolate(
    frame,
    [0, 8, sloganIntroDuration - 12, sloganIntroDuration],
    [1, 1, 1, 0]
  );
  const sloganScale = interpolate(frame, [0, 10], [0.92, 1]);

  return (
    <BrandProvider value={brand}>
      <AbsoluteFill style={{ backgroundColor: BRAND.dark }}>
        {audioSrc && <Audio src={audioSrc} volume={audioVolume} />}

        {/* === HOOK BACKGROUND: blurred first photo === */}
        {images[0] && frame < firstStart + 20 && (
          <AbsoluteFill style={{ opacity: hookBgOpacity }}>
            <Img
              src={resolveSrc(images[0].src)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'blur(10px) saturate(0.8) brightness(0.5)',
                transform: 'scale(1.06)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 100%)',
              }}
            />
          </AbsoluteFill>
        )}

        {/* === GALLERY: stacked crossfading photos with slow Ken Burns drift === */}
        {images.map((img, i) => {
          const t = timing.images[i];
          const isLast = i === images.length - 1;
          const holdUntil = isLast ? timing.ctaStart + 20 : t.end;
          if (frame < t.start || frame > holdUntil) return null;

          // Fade in over the previous photo; last photo fades under the CTA
          const opacity = interpolate(
            frame,
            isLast
              ? [t.start, t.start + 18, timing.ctaStart, timing.ctaStart + 20]
              : [t.start, t.start + 18, holdUntil, holdUntil + 1],
            isLast ? [0, 1, 1, 0.25] : [0, 1, 1, 1]
          );

          // Ken Burns: slow zoom, drift direction alternates per photo
          const p = Math.max(0, Math.min(1, (frame - t.start) / (t.end - t.start)));
          const scale = 1.08 + 0.08 * p;
          const driftX = (i % 2 === 0 ? 1 : -1) * 22 * p;
          const driftY = (i % 3 === 0 ? -1 : 1) * 14 * p;

          const labelOpacity = interpolate(
            frame,
            [t.start + 12, t.start + 26, t.end - 14, t.end],
            [0, 1, 1, isLast ? 1 : 0]
          );

          return (
            <AbsoluteFill key={i} style={{ opacity }}>
              <Img
                src={resolveSrc(img.src)}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${scale}) translate(${driftX}px, ${driftY}px)`,
                }}
              />

              {/* Soft top + bottom shade so chips and TikTok UI stay readable */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `linear-gradient(to bottom, ${BRAND.dark}66 0%, transparent 18%, transparent 70%, ${BRAND.dark}99 100%)`,
                }}
              />

              {/* Label chip, kept above the TikTok bottom safe zone */}
              {img.label && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: SAFE_ZONE.bottom + 40,
                    left: 0,
                    right: SAFE_ZONE.rail,
                    display: 'flex',
                    justifyContent: 'center',
                    opacity: labelOpacity,
                  }}
                >
                  <div
                    style={{
                      fontFamily: playfair,
                      fontSize: 34,
                      fontWeight: 700,
                      fontStyle: 'italic',
                      color: BRAND.white,
                      background: `${BRAND.dark}CC`,
                      border: `1px solid ${BRAND.coral}80`,
                      borderRadius: 40,
                      paddingLeft: 36,
                      paddingRight: 36,
                      paddingTop: 14,
                      paddingBottom: 14,
                      textShadow: `0 2px 12px ${BRAND.dark}`,
                      boxShadow: `0 8px 32px ${BRAND.dark}99, 0 0 40px ${BRAND.coral}20`,
                    }}
                  >
                    {img.label}
                  </div>
                </div>
              )}
            </AbsoluteFill>
          );
        })}

        {/* === SLOGAN INTRO (frame 0, doubles as the thumbnail) === */}
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
              {slogan || 'Fresh work, straight from the chair.'}
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

        {/* === HOOK TEXT === */}
        <HookText
          text={hookText}
          startFrame={sloganIntroDuration - 10}
          endFrame={timing.hookEnd + 30}
          fontSize={54}
          position="center"
          teaser={hookTeaser}
        />

        {/* === CTA === */}
        <EternalFrameCTA
          startFrame={timing.ctaStart}
          endFrame={timing.ctaEnd}
          slogan={slogan}
        />

        {/* === Bottom gradient (TikTok UI safe area) === */}
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

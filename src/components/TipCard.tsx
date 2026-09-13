import React from 'react';
import { AbsoluteFill, useCurrentFrame, Img, staticFile } from 'remotion';
import { SAFE_ZONE, interpolate, type TipTiming } from '../config';
import { useBrand } from '../brand';
import { TipVisual, type TipVisualSpec } from './TipVisual';

export interface TipCardProps {
  tipTitle: string;
  tipBody: string;
  tipImageSrc?: string;
  /** Additional b-roll images cross-faded behind the card. */
  tipImages?: string[];
  /** Emoji accent shown in the card header. */
  tipIcon?: string;
  /** Animated vignette in the empty area below a text-only card. */
  tipVisual?: TipVisualSpec;
  tipSource?: string;
  timing: TipTiming;
  tipIndex: number;
  totalTips: number;
}

export const TipCard: React.FC<TipCardProps> = ({
  tipTitle,
  tipBody,
  tipImageSrc,
  tipImages,
  tipIcon,
  tipVisual,
  tipSource,
  timing: T,
  tipIndex,
  totalTips,
}) => {
  const frame = useCurrentFrame();
  const { colors: BRAND } = useBrand();

  // Only render when this tip is active
  if (frame < T.tipStart - 5 || frame > T.tipEnd + 5) return null;

  // Entrance / exit
  const tipOpacity = interpolate(frame, [T.tipStart, T.tipStart + 15], [0, 1]);
  const tipFadeOut = interpolate(frame, [T.tipEnd - 15, T.tipEnd], [1, 0]);
  const visible = tipOpacity * tipFadeOut;
  const cardSlide = interpolate(frame, [T.tipStart, T.tipStart + 20], [80, 0]);
  // ponytail: wider when it stands alone. Beside an icon chip a 64px rule is a
  // companion mark; without one it carries the header row by itself, and at
  // 64px it reads as a leftover dash rather than a deliberate rule.
  const accentWidth = interpolate(
    frame,
    [T.tipStart + 6, T.tipStart + 26],
    [0, tipIcon ? 64 : 112]
  );

  // Kinetic title: slight extra rise + settle, layered on the card slide
  const titleRise = interpolate(frame, [T.tipStart + 4, T.tipStart + 24], [24, 0]);
  const titleOpacity = interpolate(frame, [T.tipStart + 4, T.tipStart + 20], [0, 1]);

  // Background imagery (primary + b-roll), with Ken Burns + cross-fade
  const images = ([tipImageSrc, ...(tipImages || [])].filter(Boolean) as string[])
    .map((src) => (src.startsWith('http') ? src : staticFile(src))); // same resolve rule as ShowcaseGallery
  const hasBg = images.length > 0;

  const kbScale = interpolate(frame, [T.tipStart, T.tipEnd], [1.06, 1.18]);
  const kbTranslate = interpolate(frame, [T.tipStart, T.tipEnd], [0, -28]);

  const span = Math.max(1, T.tipEnd - T.tipStart);
  const segLen = span / images.length;
  const fade = 12;

  return (
    <>
      {/* === Full-bleed background imagery === */}
      {hasBg && (
        <AbsoluteFill style={{ opacity: visible }}>
          {images.map((src, i) => {
            const segStart = T.tipStart + i * segLen;
            const segEnd = segStart + segLen;
            const imgOpacity =
              images.length === 1
                ? 1
                : interpolate(
                    frame,
                    [segStart - fade, segStart + fade, segEnd - fade, segEnd + fade],
                    [0, 1, 1, 0]
                  );
            return (
              <AbsoluteFill key={i} style={{ opacity: imgOpacity }}>
                <Img
                  src={src}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: `scale(${kbScale}) translateY(${kbTranslate}px)`,
                  }}
                />
              </AbsoluteFill>
            );
          })}
          {/* Legibility scrim — darker toward the bottom where the card sits */}
          <AbsoluteFill
            style={{
              // ponytail: banded, not blanket. The text sits bare on the photo, so a
              // scrim is the only thing between white type and a bright ceiling shot —
              // but darkening the whole frame to get it costs the photo. So: dark only
              // across 34-58%, where the centred text band actually lands (the content
              // div spans SAFE_ZONE.top 230 -> bottom 500 of 1920, centred, so its
              // midpoint is ~43%), and near-clear at 8-24% and 70% so the nails and the
              // salon read at full brightness. Ramps are 10-12% wide so the transition
              // doesn't band on a flat wall. Moving the text? Move the plateau with it.
              background:
                'linear-gradient(to bottom, rgba(10,12,24,0.45) 0%, rgba(10,12,24,0.08) 8%, rgba(10,12,24,0.10) 24%, rgba(10,12,24,0.55) 34%, rgba(10,12,24,0.55) 58%, rgba(10,12,24,0.12) 70%, rgba(10,12,24,0.20) 85%, rgba(10,12,24,0.70) 100%)',
            }}
          />
        </AbsoluteFill>
      )}

      {/* === Animated vignette below the card (text-only tips) === */}
      {tipVisual && !hasBg && <TipVisual spec={tipVisual} timing={T} visible={visible} />}

      {/* === Tip content === */}
      <div
        style={{
          position: 'absolute',
          left: SAFE_ZONE.side,
          right: SAFE_ZONE.rail,
          // ponytail: span the usable band and centre in it, rather than
          // hugging the bottom safe zone. On TikTok that bottom 500px is
          // filled by the app's caption and action rail — but on Facebook,
          // where this client actually posts, nothing overlays it, so the card
          // sat against a dead quarter-frame. Centring keeps clear of both
          // zones and needs no height maths, so it holds for any text length.
          ...(hasBg
            ? {
                top: SAFE_ZONE.top,
                bottom: SAFE_ZONE.bottom,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }
            : { top: '18%' }),
          opacity: visible,
          transform: `translateY(${cardSlide}px)`,
        }}
      >
        {/* Tip number indicator for multi-tip */}
        {totalTips > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <div
              style={{
                // ponytail: chips carry their own dark backing — they sit on bare photo now.
                background: `${BRAND.dark}B3`,
                border: `1px solid ${BRAND.coral}59`,
                backdropFilter: 'blur(10px)',
                borderRadius: 20,
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: 18,
                  fontWeight: 600,
                  color: BRAND.coral,
                  letterSpacing: 1,
                }}
              >
                {/* ponytail: digits, not "Tip N of M" — the card's language is
                    the client's, and this chip was always English. */}
                {tipIndex + 1} / {totalTips}
              </span>
            </div>
          </div>
        )}

        {/* Tip content card */}
        <div>
          {/* Header row: icon chip + animated accent bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            {tipIcon && (
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 18,
                  background: `linear-gradient(135deg, ${BRAND.coral}33, ${BRAND.teal}33)`,
                  border: `1px solid ${BRAND.textMuted}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 36,
                  flexShrink: 0,
                }}
              >
                {tipIcon}
              </div>
            )}
            <div
              style={{
                width: accentWidth,
                height: 4,
                borderRadius: 2,
                background: `linear-gradient(to right, ${BRAND.coral}, ${BRAND.teal})`,
              }}
            />
          </div>

          {/* Tip title */}
          <div
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 40,
              fontWeight: 700,
              color: BRAND.white,
              lineHeight: 1.3,
              marginBottom: 20,
              letterSpacing: -0.5,
              textShadow: `0 2px 10px ${BRAND.dark}, 0 6px 34px ${BRAND.dark}E6`,
              opacity: titleOpacity,
              transform: `translateY(${titleRise}px)`,
            }}
          >
            {tipTitle}
          </div>

          {/* Tip body */}
          <div
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 28,
              fontWeight: 400,
              color: BRAND.textLight,
              lineHeight: 1.6,
              textShadow: `0 2px 10px ${BRAND.dark}, 0 5px 28px ${BRAND.dark}E6`,
            }}
          >
            {tipBody}
          </div>
        </div>

        {/* Source badge */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
          <div
            style={{
              background: `${BRAND.dark}B3`,
              border: `1px solid ${BRAND.teal}59`,
              backdropFilter: 'blur(10px)',
              borderRadius: 20,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 18,
                color: BRAND.amber, // teal on a dark chip was ~2.8:1
                fontWeight: 500,
              }}
            >
              {tipSource || 'From 100+ prompt experiments'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

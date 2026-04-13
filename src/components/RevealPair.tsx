import React from 'react';
import { AbsoluteFill, useCurrentFrame, Img } from 'remotion';
import { BRAND, interpolate, type PairTiming } from '../config';

interface RevealPairProps {
  beforeImageSrc: string;
  afterImageSrc: string;
  photoEra?: string;
  pairTiming: PairTiming;
  pairIndex: number;
  totalPairs: number;
}

export const RevealPair: React.FC<RevealPairProps> = ({
  beforeImageSrc,
  afterImageSrc,
  photoEra,
  pairTiming: T,
  pairIndex,
  totalPairs,
}) => {
  const frame = useCurrentFrame();

  // Alternate swipe direction: even pairs left-to-right, odd right-to-left
  const swipeReversed = pairIndex % 2 === 1;

  // Vary zoom range per pair for visual variety
  const zoomMax = 1.12 + (pairIndex % 3) * 0.03; // 1.12, 1.15, 1.18

  // === Before image: slow Ken Burns zoom ===
  const beforeZoom = interpolate(frame, [T.beforeStart, T.beforeEnd], [1.0, zoomMax]);
  const beforeOpacity = interpolate(frame, [T.transitionStart, T.transitionEnd], [1, 0]);

  // === Swipe transition: diagonal wipe ===
  const swipeProgress = interpolate(frame, [T.transitionStart, T.transitionEnd], [0, 100]);

  // Build clip path based on swipe direction
  const clipPath = swipeReversed
    ? `polygon(${swipeProgress}% 0, 100% 0, 100% 100%, ${swipeProgress}% 100%)`
    : `polygon(0 0, ${100 - swipeProgress}% 0, ${100 - swipeProgress}% 100%, 0 100%)`;

  // === After image: slow pan ===
  const afterPanX = interpolate(frame, [T.afterStart, T.afterEnd], [-20, 20]);
  const afterOpacity = interpolate(frame, [T.afterStart - 10, T.afterStart + 5], [0, 1]);
  const afterZoom = interpolate(frame, [T.afterStart, T.afterEnd], [1.05, 1.0]);

  // === Labels ===
  const beforeLabelOpacity = interpolate(
    frame,
    [T.beforeStart + 20, T.beforeStart + 30, T.transitionStart, T.transitionStart + 10],
    [0, 0.8, 0.8, 0]
  );
  const afterLabelOpacity = interpolate(
    frame,
    [T.afterStart + 10, T.afterStart + 20, T.afterEnd - 15, T.afterEnd],
    [0, 0.8, 0.8, 0]
  );

  // === Era badge ===
  const eraOpacity = interpolate(
    frame,
    [T.beforeStart + 35, T.beforeStart + 45, T.transitionStart - 10, T.transitionStart],
    [0, 1, 1, 0]
  );

  // === Pair counter badge ===
  const counterOpacity = totalPairs > 1
    ? interpolate(
        frame,
        [T.beforeStart, T.beforeStart + 15, T.afterEnd - 15, T.afterEnd],
        [0, 0.7, 0.7, 0]
      )
    : 0;

  // Only render when this pair is active (with some padding)
  if (frame < T.beforeStart - 5 || frame > T.afterEnd + 10) return null;

  return (
    <>
      {/* === BEFORE IMAGE LAYER === */}
      <AbsoluteFill
        style={{
          opacity: beforeOpacity,
          clipPath,
        }}
      >
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <Img
            src={beforeImageSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${beforeZoom})`,
              filter: 'saturate(0.7)',
            }}
          />
        </div>

        {/* Dark vignette overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)',
          }}
        />

        {/* "Before" label */}
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: 60,
            opacity: beforeLabelOpacity,
          }}
        >
          <div
            style={{
              background: `${BRAND.dark}AA`,
              borderRadius: 12,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 8,
              paddingBottom: 8,
              border: `1px solid ${BRAND.textMuted}44`,
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 22,
                fontWeight: 500,
                color: BRAND.textMuted,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              Before
            </span>
          </div>
        </div>

        {/* Era badge */}
        {photoEra && (
          <div
            style={{
              position: 'absolute',
              top: 80,
              right: 60,
              opacity: eraOpacity,
            }}
          >
            <div
              style={{
                background: `${BRAND.amber}DD`,
                borderRadius: 12,
                paddingLeft: 20,
                paddingRight: 20,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            >
              <span
                style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: 22,
                  fontWeight: 600,
                  color: BRAND.dark,
                }}
              >
                {photoEra}
              </span>
            </div>
          </div>
        )}
      </AbsoluteFill>

      {/* === AFTER IMAGE LAYER === */}
      <AbsoluteFill style={{ opacity: afterOpacity }}>
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <Img
            src={afterImageSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${afterZoom}) translateX(${afterPanX}px)`,
            }}
          />
        </div>

        {/* Subtle warm overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `${BRAND.amber}08`,
          }}
        />

        {/* "Restored" label */}
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: 60,
            opacity: afterLabelOpacity,
          }}
        >
          <div
            style={{
              background: `${BRAND.teal}DD`,
              borderRadius: 12,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 22,
                fontWeight: 600,
                color: BRAND.white,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              Restored ✦
            </span>
          </div>
        </div>
      </AbsoluteFill>

      {/* === TRANSITION FLASH === */}
      {frame >= T.transitionStart + 10 && frame <= T.transitionStart + 18 && (
        <AbsoluteFill
          style={{
            backgroundColor: BRAND.white,
            opacity: interpolate(
              frame,
              [T.transitionStart + 10, T.transitionStart + 14, T.transitionStart + 18],
              [0, 0.4, 0]
            ),
          }}
        />
      )}

      {/* === PAIR COUNTER BADGE === */}
      {totalPairs > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            opacity: counterOpacity,
          }}
        >
          <div
            style={{
              background: `${BRAND.dark}BB`,
              borderRadius: 20,
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 6,
              paddingBottom: 6,
              border: `1px solid ${BRAND.textMuted}44`,
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 18,
                fontWeight: 500,
                color: BRAND.textLight,
                letterSpacing: 1,
              }}
            >
              {pairIndex + 1}/{totalPairs}
            </span>
          </div>
        </div>
      )}
    </>
  );
};

import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  staticFile,
  Audio,
} from 'remotion';
import { BRAND, VIDEO, REVEAL_TIMING as T, interpolate } from '../config';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';

// Props passed from the render script / content pool
export interface RevealProps {
  hookText: string;           // e.g. "This photo sat in a drawer for 47 years..."
  beforeImageSrc: string;     // URL or static file path
  afterImageSrc: string;
  photoEra?: string;          // e.g. "1960s"
  musicFile?: string;         // royalty-free track filename
}

export const BeforeAfterReveal: React.FC<RevealProps> = ({
  hookText,
  beforeImageSrc,
  afterImageSrc,
  photoEra,
  musicFile,
}) => {
  const frame = useCurrentFrame();

  // === Before image: slow zoom (1.0 → 1.15) ===
  const beforeZoom = interpolate(
    frame,
    [T.beforeStart, T.beforeEnd],
    [1.0, 1.15]
  );
  const beforeOpacity = interpolate(
    frame,
    [T.transitionStart, T.transitionEnd],
    [1, 0]
  );

  // === Swipe transition: a diagonal wipe ===
  const swipeProgress = interpolate(
    frame,
    [T.transitionStart, T.transitionEnd],
    [0, 100]
  );

  // === After image: slow pan (slight drift right) ===
  const afterPanX = interpolate(
    frame,
    [T.afterStart, T.afterEnd],
    [-20, 20]
  );
  const afterOpacity = interpolate(
    frame,
    [T.afterStart - 10, T.afterStart + 5],
    [0, 1]
  );
  const afterZoom = interpolate(
    frame,
    [T.afterStart, T.afterEnd],
    [1.05, 1.0]
  );

  // === "Before" / "After" labels ===
  const beforeLabelOpacity = interpolate(
    frame,
    [T.beforeStart + 30, T.beforeStart + 40, T.transitionStart, T.transitionStart + 10],
    [0, 0.8, 0.8, 0]
  );
  const afterLabelOpacity = interpolate(
    frame,
    [T.afterStart + 10, T.afterStart + 20, T.ctaStart - 10, T.ctaStart],
    [0, 0.8, 0.8, 0]
  );

  // === Era badge ===
  const eraOpacity = interpolate(
    frame,
    [T.beforeStart + 45, T.beforeStart + 55, T.transitionStart - 10, T.transitionStart],
    [0, 1, 1, 0]
  );

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.dark }}>
      {/* Background music */}
      {musicFile && (
        <Audio src={staticFile(musicFile)} volume={0.6} />
      )}

      {/* === BEFORE IMAGE LAYER === */}
      <AbsoluteFill
        style={{
          opacity: beforeOpacity,
          clipPath: `polygon(0 0, 100% 0, ${100 - swipeProgress}% 100%, 0 100%)`,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
        >
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
            background:
              'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)',
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
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
        >
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

        {/* Subtle warm overlay to enhance the "restored" feeling */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `${BRAND.amber}08`,
          }}
        />

        {/* "After" label */}
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

      {/* === TRANSITION FLASH (brief white flash at midpoint) === */}
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

      {/* === HOOK TEXT === */}
      <HookText
        text={hookText}
        startFrame={T.hookStart}
        endFrame={T.hookEnd + 30}
        fontSize={48}
        position="center"
      />

      {/* === CTA === */}
      <EternalFrameCTA startFrame={T.ctaStart} endFrame={T.ctaEnd} />

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

import React from 'react';
import { useCurrentFrame } from 'remotion';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { interpolate } from '../config';
import { useBrand } from '../brand';

// Load fonts for rendering
const { fontFamily: playfair } = loadPlayfair();
const { fontFamily: inter } = loadInter();

interface HookTextProps {
  text: string;
  startFrame: number;
  endFrame: number;
  fontSize?: number;
  position?: 'center' | 'top' | 'bottom';
  /** Uppercase teaser line under the hook card. */
  teaser?: string;
}

export const HookText: React.FC<HookTextProps> = ({
  text,
  startFrame,
  endFrame,
  fontSize = 56,
  position = 'center',
  teaser = 'watch the transformation',
}) => {
  const frame = useCurrentFrame();
  const { colors: BRAND } = useBrand();
  const f = frame - startFrame;

  if (frame < startFrame || frame > endFrame) return null;

  // Split into lines, then each line into words for word-by-word reveal
  const lines = text.split('\n');
  const wordDelay = 3; // frames between each word appearing
  let wordIndex = 0;

  // Overall fade out near the end
  const fadeOut = interpolate(frame, [endFrame - 15, endFrame], [1, 0]);

  // Subtle background pulse
  const bgPulse = 0.85 + 0.05 * Math.sin(f * 0.08);

  const topPosition =
    position === 'top' ? '12%' : position === 'bottom' ? '60%' : '32%';

  return (
    <div
      style={{
        position: 'absolute',
        top: topPosition,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      {/* Ambient glow behind text */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 700,
          height: 400,
          background: `radial-gradient(ellipse, ${BRAND.coral}20 0%, ${BRAND.teal}0C 50%, transparent 70%)`,
          opacity: bgPulse,
          filter: 'blur(40px)',
        }}
      />

      {/* Text container with glass backdrop */}
      <div
        style={{
          position: 'relative',
          background: `${BRAND.dark}D0`,
          borderRadius: 32,
          paddingLeft: 56,
          paddingRight: 56,
          paddingTop: 44,
          paddingBottom: 44,
          border: `1px solid ${BRAND.textMuted}20`,
          boxShadow: `0 20px 80px ${BRAND.dark}CC, 0 0 100px ${BRAND.coral}0A`,
          maxWidth: 940,
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: 'absolute',
            top: -1,
            left: 80,
            right: 80,
            height: 2,
            background: `linear-gradient(to right, transparent, ${BRAND.coral}80, ${BRAND.amber}80, transparent)`,
            opacity: interpolate(frame, [startFrame, startFrame + 12], [0, 1]),
          }}
        />

        {/* Word-by-word reveal */}
        {lines.map((line, lineIdx) => {
          const words = line.split(' ');

          return (
            <div
              key={lineIdx}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '0 14px',
                lineHeight: 1.35,
                marginBottom: lineIdx < lines.length - 1 ? 4 : 0,
              }}
            >
              {words.map((word, wIdx) => {
                const thisWordIndex = wordIndex;
                wordIndex++;

                const wordStart = startFrame + thisWordIndex * wordDelay;
                const wordOpacity = interpolate(frame, [wordStart, wordStart + 6], [0, 1]);
                const wordSlideY = interpolate(frame, [wordStart, wordStart + 8], [18, 0]);
                const wordScale = interpolate(frame, [wordStart, wordStart + 6], [0.88, 1]);

                return (
                  <span
                    key={wIdx}
                    style={{
                      fontFamily: playfair,
                      fontSize,
                      fontWeight: 700,
                      color: BRAND.white,
                      textAlign: 'center',
                      letterSpacing: -0.3,
                      opacity: wordOpacity,
                      transform: `translateY(${wordSlideY}px) scale(${wordScale})`,
                      display: 'inline-block',
                      textShadow: `0 2px 20px ${BRAND.dark}`,
                    }}
                  >
                    {word}
                  </span>
                );
              })}
            </div>
          );
        })}

        {/* Bottom accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: -1,
            left: 80,
            right: 80,
            height: 2,
            background: `linear-gradient(to right, transparent, ${BRAND.teal}80, ${BRAND.amber}80, transparent)`,
            opacity: interpolate(
              frame,
              [startFrame + wordIndex * wordDelay, startFrame + wordIndex * wordDelay + 10],
              [0, 1]
            ),
          }}
        />
      </div>

      {/* "Watch the transformation" teaser */}
      <div
        style={{
          marginTop: 28,
          opacity: interpolate(
            frame,
            [
              startFrame + wordIndex * wordDelay + 8,
              startFrame + wordIndex * wordDelay + 18,
              endFrame - 20,
              endFrame - 10,
            ],
            [0, 0.7, 0.7, 0]
          ),
        }}
      >
        <div
          style={{
            fontFamily: inter,
            fontSize: 20,
            fontWeight: 500,
            color: BRAND.textMuted,
            letterSpacing: 4,
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ color: BRAND.amber, fontSize: 14 }}>&#9660;</span>
          {teaser}
          <span style={{ color: BRAND.amber, fontSize: 14 }}>&#9660;</span>
        </div>
      </div>
    </div>
  );
};

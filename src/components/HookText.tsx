import React from 'react';
import { useCurrentFrame } from 'remotion';
import { BRAND, interpolate } from '../config';

interface HookTextProps {
  text: string;
  startFrame: number;
  endFrame: number;
  fontSize?: number;
  position?: 'center' | 'top' | 'bottom';
}

export const HookText: React.FC<HookTextProps> = ({
  text,
  startFrame,
  endFrame,
  fontSize = 56,
  position = 'center',
}) => {
  const frame = useCurrentFrame();

  // Fade in
  const fadeIn = interpolate(frame, [startFrame, startFrame + 10], [0, 1]);
  // Fade out
  const fadeOut = interpolate(frame, [endFrame - 12, endFrame], [1, 0]);
  const opacity = Math.min(fadeIn, fadeOut);

  // Slide up on entry
  const translateY = interpolate(frame, [startFrame, startFrame + 15], [40, 0]);

  // Scale pop
  const scale = interpolate(frame, [startFrame, startFrame + 12], [0.9, 1]);

  if (frame < startFrame || frame > endFrame) return null;

  const topPosition =
    position === 'top' ? '15%' : position === 'bottom' ? '65%' : '40%';

  // Split text into lines for multi-line support
  const lines = text.split('\n');

  return (
    <div
      style={{
        position: 'absolute',
        top: topPosition,
        left: 60,
        right: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
      }}
    >
      {/* Backdrop blur effect (semi-transparent bg) */}
      <div
        style={{
          background: `${BRAND.dark}CC`,
          borderRadius: 24,
          paddingLeft: 40,
          paddingRight: 40,
          paddingTop: 28,
          paddingBottom: 28,
          border: `1px solid ${BRAND.textMuted}33`,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize,
              fontWeight: 700,
              color: BRAND.white,
              textAlign: 'center',
              lineHeight: 1.3,
              letterSpacing: -0.5,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

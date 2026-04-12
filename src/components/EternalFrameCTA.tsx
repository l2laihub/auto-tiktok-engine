import React from 'react';
import { useCurrentFrame } from 'remotion';
import { BRAND, VIDEO, interpolate } from '../config';

interface CTAProps {
  startFrame: number;
  endFrame: number;
}

export const EternalFrameCTA: React.FC<CTAProps> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();

  // Fade + slide up
  const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 1]);
  const translateY = interpolate(frame, [startFrame, startFrame + 20], [60, 0]);

  // Subtle pulse on the button
  const pulseScale = frame > startFrame + 30
    ? 1 + 0.02 * Math.sin((frame - startFrame - 30) * 0.15)
    : 1;

  if (frame < startFrame || frame > endFrame) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 200,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      {/* App icon placeholder */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: `linear-gradient(135deg, ${BRAND.coral}, ${BRAND.teal})`,
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 8px 32px ${BRAND.coral}66`,
        }}
      >
        <span style={{ fontSize: 36, color: BRAND.white }}>✦</span>
      </div>

      {/* App name */}
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 42,
          fontWeight: 700,
          color: BRAND.white,
          letterSpacing: -0.5,
          marginBottom: 8,
        }}
      >
        EternalFrame
      </div>

      {/* Tagline */}
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 24,
          color: BRAND.textMuted,
          marginBottom: 32,
        }}
      >
        Restore your family memories with AI
      </div>

      {/* CTA button */}
      <div
        style={{
          background: BRAND.coral,
          paddingLeft: 48,
          paddingRight: 48,
          paddingTop: 18,
          paddingBottom: 18,
          borderRadius: 50,
          transform: `scale(${pulseScale})`,
          boxShadow: `0 4px 24px ${BRAND.coral}88`,
        }}
      >
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 28,
            fontWeight: 600,
            color: BRAND.white,
            letterSpacing: 0.5,
          }}
        >
          Try it free →
        </span>
      </div>

      {/* Available on */}
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 18,
          color: BRAND.textMuted,
          marginTop: 16,
        }}
      >
        Available on iOS · eternalframe.app/try
      </div>
    </div>
  );
};

import React from 'react';
import { useCurrentFrame, Img } from 'remotion';
import { BRAND, interpolate, type TipTiming } from '../config';

export interface TipCardProps {
  tipTitle: string;
  tipBody: string;
  tipImageSrc?: string;
  tipSource?: string;
  timing: TipTiming;
  tipIndex: number;
  totalTips: number;
}

export const TipCard: React.FC<TipCardProps> = ({
  tipTitle,
  tipBody,
  tipImageSrc,
  tipSource,
  timing: T,
  tipIndex,
  totalTips,
}) => {
  const frame = useCurrentFrame();

  // Entrance animation
  const tipOpacity = interpolate(frame, [T.tipStart, T.tipStart + 15], [0, 1]);
  const tipSlide = interpolate(frame, [T.tipStart, T.tipStart + 20], [80, 0]);
  // Exit animation
  const tipFadeOut = interpolate(frame, [T.tipEnd - 15, T.tipEnd], [1, 0]);

  // Only render when this tip is active
  if (frame < T.tipStart - 5 || frame > T.tipEnd + 5) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '18%',
        left: 48,
        right: 48,
        opacity: tipOpacity * tipFadeOut,
        transform: `translateY(${tipSlide}px)`,
      }}
    >
      {/* Tip number indicator for multi-tip */}
      {totalTips > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              background: `${BRAND.coral}33`,
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
              Tip {tipIndex + 1} of {totalTips}
            </span>
          </div>
        </div>
      )}

      {/* Optional image */}
      {tipImageSrc && (
        <div
          style={{
            width: '100%',
            height: 500,
            borderRadius: 24,
            overflow: 'hidden',
            marginBottom: 32,
            border: `1px solid ${BRAND.textMuted}22`,
          }}
        >
          <Img
            src={tipImageSrc}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </div>
      )}

      {/* Tip content card */}
      <div
        style={{
          background: `${BRAND.darkSurface}EE`,
          borderRadius: 28,
          padding: 48,
          border: `1px solid ${BRAND.textMuted}22`,
          boxShadow: `0 16px 64px ${BRAND.dark}88`,
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            width: 60,
            height: 4,
            borderRadius: 2,
            background: `linear-gradient(to right, ${BRAND.coral}, ${BRAND.teal})`,
            marginBottom: 24,
          }}
        />

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
          }}
        >
          {tipBody}
        </div>
      </div>

      {/* Source badge */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: 20,
        }}
      >
        <div
          style={{
            background: `${BRAND.teal}33`,
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
              color: BRAND.teal,
              fontWeight: 500,
            }}
          >
            {tipSource || 'From 100+ prompt experiments'}
          </span>
        </div>
      </div>
    </div>
  );
};

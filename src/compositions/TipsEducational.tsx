import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  Img,
  staticFile,
  Audio,
} from 'remotion';
import { BRAND, VIDEO, TIPS_TIMING as T, interpolate } from '../config';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';

export interface TipsProps {
  hookText: string;           // e.g. "Why do AI-restored faces look wrong?"
  tipTitle: string;           // main tip headline
  tipBody: string;            // 2-3 sentence explanation
  takeaway: string;           // key one-liner
  tipImageSrc?: string;       // optional supporting image
  musicFile?: string;
}

export const TipsEducational: React.FC<TipsProps> = ({
  hookText,
  tipTitle,
  tipBody,
  takeaway,
  tipImageSrc,
  musicFile,
}) => {
  const frame = useCurrentFrame();

  // === Animated background gradient shift ===
  const gradientAngle = interpolate(frame, [0, T.totalDuration], [135, 160]);

  // === Tip card animation ===
  const tipOpacity = interpolate(frame, [T.tipStart, T.tipStart + 15], [0, 1]);
  const tipSlide = interpolate(frame, [T.tipStart, T.tipStart + 20], [80, 0]);
  const tipFadeOut = interpolate(frame, [T.takeawayStart - 5, T.takeawayStart + 10], [1, 0]);

  // === Takeaway animation ===
  const takeawayOpacity = interpolate(
    frame,
    [T.takeawayStart, T.takeawayStart + 12],
    [0, 1]
  );
  const takeawayScale = interpolate(
    frame,
    [T.takeawayStart, T.takeawayStart + 15],
    [0.85, 1]
  );
  const takeawayFadeOut = interpolate(
    frame,
    [T.ctaStart - 5, T.ctaStart + 5],
    [1, 0]
  );

  // === Decorative floating particles ===
  const particles = Array.from({ length: 6 }, (_, i) => ({
    x: 100 + i * 160,
    y: 300 + Math.sin(frame * 0.03 + i * 1.2) * 40,
    size: 4 + (i % 3) * 2,
    opacity: 0.15 + Math.sin(frame * 0.05 + i) * 0.1,
  }));

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${gradientAngle}deg, ${BRAND.dark} 0%, ${BRAND.darkSurface} 50%, #0F3460 100%)`,
      }}
    >
      {musicFile && <Audio src={staticFile(musicFile)} volume={0.5} />}

      {/* Decorative particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            backgroundColor: i % 2 === 0 ? BRAND.coral : BRAND.teal,
            opacity: p.opacity,
          }}
        />
      ))}

      {/* === HOOK TEXT === */}
      <HookText
        text={hookText}
        startFrame={T.hookStart}
        endFrame={T.hookEnd}
        fontSize={52}
        position="center"
      />

      {/* === TIP CARD === */}
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
              From 100+ prompt experiments
            </span>
          </div>
        </div>
      </div>

      {/* === TAKEAWAY === */}
      <div
        style={{
          position: 'absolute',
          top: '35%',
          left: 48,
          right: 48,
          display: 'flex',
          justifyContent: 'center',
          opacity: takeawayOpacity * takeawayFadeOut,
          transform: `scale(${takeawayScale})`,
        }}
      >
        <div
          style={{
            background: `linear-gradient(135deg, ${BRAND.coral}22, ${BRAND.teal}22)`,
            border: `2px solid ${BRAND.coral}66`,
            borderRadius: 28,
            padding: 48,
            maxWidth: 900,
          }}
        >
          {/* Lightning icon placeholder */}
          <div
            style={{
              fontSize: 48,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            ⚡
          </div>
          <div
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 44,
              fontWeight: 700,
              color: BRAND.white,
              textAlign: 'center',
              lineHeight: 1.3,
            }}
          >
            {takeaway}
          </div>
        </div>
      </div>

      {/* === CTA === */}
      <EternalFrameCTA startFrame={T.ctaStart} endFrame={T.ctaEnd} />

      {/* Bottom gradient for TikTok safe area */}
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

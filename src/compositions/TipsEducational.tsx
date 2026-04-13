import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  staticFile,
  Audio,
} from 'remotion';
import { BRAND, createTipsTiming, interpolate } from '../config';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';
import { TipCard } from '../components/TipCard';

// Per-tip data
export interface TipItem {
  tipTitle: string;
  tipBody: string;
  tipImageSrc?: string;
  tipSource?: string;
}

export interface TipsProps {
  hookText: string;
  takeaway: string;
  // Legacy single-tip support (backwards compat)
  tipTitle?: string;
  tipBody?: string;
  tipImageSrc?: string;
  // Multi-tip support
  tips?: TipItem[];
  // Audio
  musicFile?: string;
  audioVolume?: number;
  // CTA
  slogan?: string;
}

export const TipsEducational: React.FC<TipsProps> = ({
  hookText,
  takeaway,
  tipTitle,
  tipBody,
  tipImageSrc,
  tips: tipsProp,
  musicFile,
  audioVolume = 0.5,
  slogan,
}) => {
  const frame = useCurrentFrame();

  // Normalize: use tips array if provided, else build from legacy props
  const tips: TipItem[] = tipsProp && tipsProp.length > 0
    ? tipsProp
    : [{
        tipTitle: tipTitle || '',
        tipBody: tipBody || '',
        tipImageSrc,
      }];

  const timing = createTipsTiming(tips.length);

  // === Animated background gradient shift ===
  const gradientAngle = interpolate(frame, [0, timing.totalDuration], [135, 160]);

  // === Takeaway animation ===
  const takeawayOpacity = interpolate(
    frame,
    [timing.takeawayStart, timing.takeawayStart + 12],
    [0, 1]
  );
  const takeawayScale = interpolate(
    frame,
    [timing.takeawayStart, timing.takeawayStart + 15],
    [0.85, 1]
  );
  const takeawayFadeOut = interpolate(
    frame,
    [timing.ctaStart - 5, timing.ctaStart + 5],
    [1, 0]
  );

  // === Decorative floating particles ===
  const particles = Array.from({ length: 6 }, (_, i) => ({
    x: 100 + i * 160,
    y: 300 + Math.sin(frame * 0.03 + i * 1.2) * 40,
    size: 4 + (i % 3) * 2,
    opacity: 0.15 + Math.sin(frame * 0.05 + i) * 0.1,
  }));

  // Resolve audio source: URL or static file
  const audioSrc = musicFile
    ? musicFile.startsWith('http') ? musicFile : staticFile(musicFile)
    : undefined;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${gradientAngle}deg, ${BRAND.dark} 0%, ${BRAND.darkSurface} 50%, #0F3460 100%)`,
      }}
    >
      {audioSrc && <Audio src={audioSrc} volume={audioVolume} />}

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
        startFrame={timing.hookStart}
        endFrame={timing.hookEnd}
        fontSize={52}
        position="center"
      />

      {/* === TIP CARDS === */}
      {tips.map((tip, i) => (
        <TipCard
          key={i}
          tipTitle={tip.tipTitle}
          tipBody={tip.tipBody}
          tipImageSrc={tip.tipImageSrc}
          tipSource={tip.tipSource}
          timing={timing.tips[i]}
          tipIndex={i}
          totalTips={tips.length}
        />
      ))}

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
      <EternalFrameCTA startFrame={timing.ctaStart} endFrame={timing.ctaEnd} slogan={slogan} />

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

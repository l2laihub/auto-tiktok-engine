import React from 'react';
import { useCurrentFrame } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { interpolate, type TipTiming } from '../config';
import { useBrand } from '../brand';

const { fontFamily: inter } = loadInter();

// Animated vignette shown in the empty area under a text-only tip card.
// Presets keyed by `kind`; all timing is relative to the tip's start frame.
export type TipVisualSpec =
  | { kind: 'search'; query?: string }
  | { kind: 'oneTap'; chips?: { icon: string; label: string }[] }
  | { kind: 'nextDoor'; yourLabel?: string; otherLabel?: string };

interface Props {
  spec: TipVisualSpec;
  timing: TipTiming;
  /** Combined entrance/exit opacity from the parent card. */
  visible: number;
}

export const TipVisual: React.FC<Props> = ({ spec, timing: T, visible }) => {
  const frame = useCurrentFrame();
  const { colors: BRAND } = useBrand();
  const f = frame - T.tipStart;

  const enter = interpolate(f, [20, 34], [0, 1]);
  const rise = interpolate(f, [20, 34], [50, 0]);
  const float = Math.sin(f * 0.05) * 6;

  const panel: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: 90,
    right: 90,
    opacity: visible * enter,
    transform: `translateY(${rise + float}px)`,
    fontFamily: inter,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };

  if (spec.kind === 'search') {
    const query = spec.query ?? 'your shop name';
    const typedChars = Math.floor(interpolate(f, [34, 80], [0, query.length]));
    const cursorOn = f < 86 && f % 18 < 9;
    const rowIn = (i: number) => interpolate(f, [90 + i * 12, 102 + i * 12], [0, 1]);
    const shimmer = 0.45 + 0.2 * Math.sin(f * 0.12);
    return (
      <div style={panel}>
        <div
          style={{
            width: '100%',
            background: '#FBF8F3',
            borderRadius: 48,
            padding: '26px 36px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            boxShadow: `0 20px 60px rgba(0,0,0,0.45), 0 0 50px ${BRAND.coral}22`,
          }}
        >
          <span style={{ fontSize: 34 }}>🔍</span>
          <span style={{ fontSize: 36, fontWeight: 600, color: '#2C2620' }}>
            {query.slice(0, typedChars)}
            <span style={{ opacity: cursorOn ? 1 : 0, color: BRAND.coral }}>|</span>
          </span>
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: '86%',
              marginTop: 22,
              background: `${BRAND.white}10`,
              border: `1px solid ${BRAND.white}22`,
              borderRadius: 22,
              padding: '20px 28px',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              opacity: rowIn(i),
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `${BRAND.amber}${i === 0 ? '66' : '33'}`,
                opacity: shimmer + 0.3,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ height: 16, width: `${70 - i * 12}%`, borderRadius: 8, background: `${BRAND.white}44`, opacity: shimmer + 0.2 }} />
              <div style={{ height: 12, width: `${45 - i * 8}%`, borderRadius: 6, background: `${BRAND.white}26`, marginTop: 10, opacity: shimmer }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (spec.kind === 'oneTap') {
    const chips = spec.chips ?? [
      { icon: '🕐', label: 'Hours' },
      { icon: '📞', label: 'Phone' },
      { icon: '📍', label: 'Directions' },
    ];
    return (
      <div style={{ ...panel, gap: 26 }}>
        {chips.map((c, i) => {
          const start = 26 + i * 26;
          const pop = interpolate(f, [start, start + 8, start + 14], [0, 1.08, 1]);
          const chipOpacity = interpolate(f, [start, start + 8], [0, 1]);
          // Tap ripple: an expanding ring shortly after the chip lands
          const tapAt = start + 26;
          const ring = interpolate(f, [tapAt, tapAt + 22], [0, 1]);
          const ringVisible = f >= tapAt && f <= tapAt + 22;
          const checked = f >= tapAt + 14;
          return (
            <div
              key={i}
              style={{
                position: 'relative',
                width: '82%',
                background: `${BRAND.white}12`,
                border: `2px solid ${checked ? BRAND.amber : `${BRAND.white}26`}`,
                borderRadius: 28,
                padding: '26px 34px',
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                opacity: chipOpacity,
                transform: `scale(${pop})`,
              }}
            >
              {ringVisible && (
                <div
                  style={{
                    position: 'absolute',
                    right: 34,
                    top: '50%',
                    width: 30 + ring * 110,
                    height: 30 + ring * 110,
                    borderRadius: '50%',
                    border: `3px solid ${BRAND.amber}`,
                    opacity: 1 - ring,
                    transform: 'translate(35%, -50%)',
                  }}
                />
              )}
              <span style={{ fontSize: 48 }}>{c.icon}</span>
              <span style={{ flex: 1, fontSize: 38, fontWeight: 700, color: BRAND.white }}>{c.label}</span>
              <span style={{ fontSize: 40, opacity: checked ? 1 : 0.15 }}>{checked ? '✅' : '👆'}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // nextDoor: the customer drifts from your (unfindable) shop to the neighbor's
  const yourLabel = spec.yourLabel ?? 'Your shop';
  const otherLabel = spec.otherLabel ?? 'Next door';
  const walk = interpolate(f, [50, 120], [0, 1]);
  const arrived = f >= 120;
  const glow = arrived ? 0.5 + 0.3 * Math.sin((f - 120) * 0.15) : 0;
  const shopCard = (dimmed: boolean): React.CSSProperties => ({
    width: 340,
    borderRadius: 28,
    padding: '30px 24px 26px',
    textAlign: 'center',
    background: dimmed ? `${BRAND.white}0A` : `${BRAND.white}18`,
    border: dimmed ? `2px dashed ${BRAND.white}33` : `2px solid ${BRAND.amber}`,
    boxShadow: dimmed ? 'none' : `0 0 ${40 + glow * 50}px ${BRAND.amber}${arrived ? '55' : '00'}`,
    opacity: dimmed ? 0.65 : 1,
  });
  return (
    <div style={panel}>
      <div style={{ display: 'flex', gap: 60, alignItems: 'stretch' }}>
        <div style={shopCard(true)}>
          <div style={{ fontSize: 76 }}>🏪</div>
          <div style={{ fontSize: 60, fontWeight: 800, color: BRAND.coral, lineHeight: 1 }}>?</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: BRAND.textLight, marginTop: 10 }}>{yourLabel}</div>
        </div>
        <div style={shopCard(false)}>
          <div style={{ fontSize: 76 }}>🏪</div>
          <div style={{ fontSize: 60, lineHeight: 1 }}>{arrived ? '💰' : '✨'}</div>
          <div style={{ fontSize: 28, fontWeight: 600, color: BRAND.white, marginTop: 10 }}>{otherLabel}</div>
        </div>
      </div>
      {/* Walking customer */}
      <div
        style={{
          fontSize: 64,
          marginTop: 26,
          transform: `translateX(${interpolate(walk, [0, 1], [-200, 200])}px) translateY(${Math.abs(Math.sin(f * 0.4)) * -8}px) scaleX(-1)`,
        }}
      >
        🚶
      </div>
    </div>
  );
};

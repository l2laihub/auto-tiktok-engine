import React from 'react';
import { useCurrentFrame } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { interpolate } from '../config';
import { useBrand } from '../brand';

const { fontFamily: inter } = loadInter();

export interface PhoneSearchProps {
  /** Text typed into the search bar, e.g. "your shop name?" */
  query: string;
  /** Two result rows shown briefly (what customers SHOULD see). */
  foundResults?: { icon: string; title: string; sub: string }[];
  /** Empty-state line after the results vanish. */
  noResultsText?: string;
}

interface Props extends PhoneSearchProps {
  startFrame: number;
  endFrame: number;
}

// Animation phases, in frames relative to startFrame:
// 0-12 phone in · 8-50 typing · 55-85 results in · 95-110 results out ·
// 105+ empty state with "?" and a small shake · fades out before endFrame.
export const PhoneSearchHook: React.FC<Props> = ({
  query,
  foundResults = [
    { icon: '📍', title: 'Directions', sub: '2 min away · open now' },
    { icon: '🕐', title: 'Hours & phone', sub: 'one tap to call' },
  ],
  noResultsText = 'No results found',
  startFrame,
  endFrame,
}) => {
  const frame = useCurrentFrame();
  const { colors: BRAND } = useBrand();
  const f = frame - startFrame;

  if (frame < startFrame || frame > endFrame) return null;

  const phoneIn = interpolate(f, [0, 12], [0, 1]);
  const fadeOut = interpolate(frame, [endFrame - 12, endFrame], [1, 0]);

  // Typing
  const typedChars = Math.floor(interpolate(f, [8, 50], [0, query.length]));
  const typed = query.slice(0, typedChars);
  const cursorOn = f < 55 && f % 20 < 10;

  // Results in, then out
  const resultsGone = f >= 110;
  const resultOpacity = (i: number) =>
    interpolate(f, [55 + i * 8, 63 + i * 8], [0, 1]) *
    interpolate(f, [95, 108], [1, 0]);
  const resultSlide = (i: number) => interpolate(f, [55 + i * 8, 63 + i * 8], [30, 0]);

  // Empty state
  const emptyOpacity = interpolate(f, [105, 118], [0, 1]);
  const qScale = interpolate(f, [105, 118, 126], [0.4, 1.12, 1]);
  const shakeDamp = interpolate(f, [110, 145], [1, 0]);
  const shake = f >= 110 ? Math.sin((f - 110) * 1.3) * 7 * shakeDamp : 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: '27%',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity: phoneIn * fadeOut,
        transform: `translateY(${(1 - phoneIn) * 60}px) translateX(${shake}px)`,
      }}
    >
      {/* Phone body */}
      <div
        style={{
          width: 560,
          height: 950,
          borderRadius: 56,
          background: '#111',
          border: `3px solid ${BRAND.coral}55`,
          boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 80px ${BRAND.coral}22`,
          padding: 14,
          fontFamily: inter,
        }}
      >
        {/* Screen */}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            background: '#FBF8F3',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Status bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '22px 36px 8px',
              fontSize: 22,
              fontWeight: 600,
              color: '#3a3a3a',
            }}
          >
            <span>9:41</span>
            <span>📶 🔋</span>
          </div>

          {/* Search bar */}
          <div
            style={{
              margin: '20px 28px 0',
              background: '#fff',
              border: '2px solid #E3DACC',
              borderRadius: 40,
              padding: '20px 28px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              boxShadow: '0 4px 14px rgba(0,0,0,0.07)',
            }}
          >
            <span style={{ fontSize: 28 }}>🔍</span>
            <span style={{ fontSize: 30, fontWeight: 500, color: '#2C2620', whiteSpace: 'nowrap' }}>
              {typed}
              <span style={{ opacity: cursorOn ? 1 : 0, color: BRAND.coral }}>|</span>
            </span>
          </div>

          {/* Results area */}
          <div style={{ padding: '28px 28px 0', flex: 1, position: 'relative' }}>
            {!resultsGone &&
              foundResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    background: '#fff',
                    borderRadius: 24,
                    padding: '22px 26px',
                    marginBottom: 18,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 20,
                    border: '1px solid #EDE6D9',
                    opacity: resultOpacity(i),
                    transform: `translateY(${resultSlide(i)}px)`,
                  }}
                >
                  <span style={{ fontSize: 40 }}>{r.icon}</span>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#2C2620' }}>{r.title}</div>
                    <div style={{ fontSize: 23, color: '#8a8073', marginTop: 4 }}>{r.sub}</div>
                  </div>
                </div>
              ))}

            {/* Empty state */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: emptyOpacity,
              }}
            >
              <div
                style={{
                  fontSize: 120,
                  fontWeight: 800,
                  color: BRAND.coral,
                  transform: `scale(${qScale})`,
                }}
              >
                ?
              </div>
              <div style={{ fontSize: 30, fontWeight: 600, color: '#8a8073', marginTop: 12 }}>
                {noResultsText}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

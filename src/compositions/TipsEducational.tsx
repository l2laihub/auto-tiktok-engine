import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  staticFile,
  Audio,
  Img,
} from 'remotion';
import { VIDEO, createTipsTiming, interpolate } from '../config';
import { resolveBrand, BrandProvider, type BrandProps } from '../brand';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { HookText } from '../components/HookText';
import { EternalFrameCTA } from '../components/EternalFrameCTA';
import { TipCard } from '../components/TipCard';
import { PhoneSearchHook, type PhoneSearchProps } from '../components/PhoneSearchHook';
import { HookBackdrop } from '../components/HookBackdrop';

const { fontFamily: playfair } = loadPlayfair();

// Per-tip data
export interface TipItem {
  tipTitle: string;
  tipBody: string;
  tipImageSrc?: string;
  tipImages?: string[];
  tipIcon?: string;
  /** Animated vignette below a text-only card: 'search' | 'oneTap' | 'nextDoor'. */
  tipVisual?: import('../components/TipVisual').TipVisualSpec;
  tipSource?: string;
}

export interface TipsProps {
  hookText: string;
  takeaway: string;
  // Legacy single-tip support (backwards compat)
  tipTitle?: string;
  tipBody?: string;
  tipImageSrc?: string;
  tipImages?: string[];
  tipIcon?: string;
  tipSource?: string;
  // Multi-tip support
  tips?: TipItem[];
  // Audio
  musicFile?: string;
  audioVolume?: number;
  // CTA
  slogan?: string;
  // Optional animated phone-search sequence during the hook (extends the hook to 6.5s)
  phoneSearch?: PhoneSearchProps;
  /** Teaser line under the hook text (defaults to HookText's own). */
  hookTeaser?: string;
  /** Override the hook's length in seconds. Omit — it is derived from the text. */
  hookSeconds?: number;
  /** Override the takeaway's length in seconds. Omit — derived from the text. */
  takeawaySeconds?: number;
  /** Full-bleed backdrop behind the hook (path relative to public/). */
  hookImageSrc?: string;
  // Per-client branding (defaults to EternalFrame)
  brand?: BrandProps;
}

/**
 * The slogan intro owns frames 0..SLOGAN_INTRO_FRAMES; the hook starts as it
 * clears. ponytail: one constant, used by both the component and the duration
 * budget below. These were two separate hardcoded numbers (45 here, 35 baked
 * into hookSecondsFor) that only happened to agree — until they didn't, and
 * the hook's glass panel painted over the slogan mid-fade.
 */
export const SLOGAN_INTRO_FRAMES = Math.floor(1.5 * VIDEO.fps);
export const HOOK_START_FRAME = SLOGAN_INTRO_FRAMES;

/** Hook length depends on whether a phone-search sequence plays. Used by Root's calculateMetadata too. */
export const hookSecondsFor = (
  props: Pick<TipsProps, 'phoneSearch' | 'hookText' | 'hookSeconds'>
) => {
  if (props.hookSeconds) return props.hookSeconds;
  if (props.phoneSearch) return 6.5;
  // ponytail: derived, not a constant. HookText reveals word-by-word (3f each)
  // starting 35f in, the teaser then fades in over 18f, and the card fades out
  // 15f before the end. A flat 3s left a 5-word hook fully readable for 0.63s
  // and the teaser at full opacity for TWO frames. Budget: hand-off + reveal +
  // teaser fade-in + a 45f hold to actually read it + the fade tail.
  const words = (props.hookText || '').trim().split(/\s+/).filter(Boolean).length;
  // hand-off + word-by-word reveal (3f each) + teaser fade-in (18f) + a 45f
  // hold to read it + the 20f fade tail.
  return Math.max(4.5, (HOOK_START_FRAME + 18 + 45 + 20 + words * 3) / VIDEO.fps);
};

/** Takeaway length, derived the same way. Used by Root's calculateMetadata too. */
export const takeawaySecondsFor = (
  props: Pick<TipsProps, 'takeaway' | 'takeawaySeconds' | 'tips'>
) => {
  if (props.takeawaySeconds) return props.takeawaySeconds;
  const words = (props.takeaway || '').trim().split(/\s+/).filter(Boolean).length;
  const tipCount = props.tips?.length || 1;
  // ponytail: max(), not a sum. The card fades in over 12f and the recap icons
  // pop at 18f + 8f apart, settling 12f later — but that plays out WHILE the
  // line is being read, so the budget is whichever finishes last. Summing them
  // would pad every video by a second for no reason.
  // 9f/word ~= 3.3 words/sec, the comfortable subtitle rate. A flat 3s left an
  // 11-word takeaway fully composed for 0.8s.
  const readDone = 12 + words * 9;
  const iconsDone = tipCount > 1 ? 18 + (tipCount - 1) * 8 + 12 : 0;
  return Math.max(3.5, (Math.max(readDone, iconsDone) + 20) / VIDEO.fps);
};

export const TipsEducational: React.FC<TipsProps> = ({
  hookText,
  takeaway,
  tipTitle,
  tipBody,
  tipImageSrc,
  tipImages,
  tipIcon,
  tipSource,
  tips: tipsProp,
  musicFile,
  audioVolume = 0.5,
  slogan,
  phoneSearch,
  hookTeaser,
  hookImageSrc,
  hookSeconds,
  takeawaySeconds,
  brand: brandProp,
}) => {
  const frame = useCurrentFrame();
  const brand = resolveBrand(brandProp);
  const BRAND = brand.colors;

  // Normalize: use tips array if provided, else build from legacy props
  const tips: TipItem[] = tipsProp && tipsProp.length > 0
    ? tipsProp
    : [{
        tipTitle: tipTitle || '',
        tipBody: tipBody || '',
        tipImageSrc,
        tipImages,
        tipIcon,
        tipSource,
      }];

  // Must pass the same fields Root's calculateMetadata does, or the component
  // and the composition's declared duration disagree.
  const timing = createTipsTiming(
    tips.length,
    hookSecondsFor({ phoneSearch, hookText, hookSeconds }),
    takeawaySecondsFor({ takeaway, takeawaySeconds, tips: tipsProp })
  );

  // === Slogan intro: visible at frame 0 for thumbnail ===
  const sloganIntroDuration = SLOGAN_INTRO_FRAMES;
  const sloganOpacity = interpolate(
    frame,
    [0, 8, sloganIntroDuration - 12, sloganIntroDuration],
    [1, 1, 1, 0]
  );
  const sloganScale = interpolate(
    frame,
    [0, 10],
    [0.92, 1]
  );

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
    opacity: 0.25 + Math.sin(frame * 0.05 + i) * 0.15,
  }));

  // Resolve audio source: URL or static file
  const audioSrc = musicFile
    ? musicFile.startsWith('http') ? musicFile : staticFile(musicFile)
    : undefined;

  return (
    <BrandProvider value={brand}>
    <AbsoluteFill
      style={{
        background: `linear-gradient(${gradientAngle}deg, ${BRAND.dark} 0%, ${BRAND.darkSurface} 40%, color-mix(in srgb, ${BRAND.teal} 30%, ${BRAND.dark}) 75%, color-mix(in srgb, ${BRAND.teal} 45%, ${BRAND.dark}) 100%)`,
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

      {/* === HOOK BACKDROP === Painted before the slogan and hook so both read
          on top of it. From frame 0 so the thumbnail is a photo, not a bare
          gradient; hands over to the first TipCard's own imagery at hookEnd. */}
      <HookBackdrop imageSrc={hookImageSrc} startFrame={0} endFrame={timing.hookEnd} />

      {/* === SLOGAN INTRO (visible at frame 0 for thumbnail) === */}
      {frame < sloganIntroDuration && (
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: sloganOpacity,
            transform: `scale(${sloganScale})`,
          }}
        >
          {brand.logoSrc && (
            <Img
              src={brand.logoSrc.startsWith('http') ? brand.logoSrc : staticFile(brand.logoSrc)}
              style={{
                width: 120,
                height: 120,
                borderRadius: 28,
                marginBottom: 28,
                boxShadow: `0 12px 50px ${BRAND.dark}`,
              }}
            />
          )}
          <div
            style={{
              fontFamily: playfair,
              fontSize: 52,
              fontWeight: 700,
              fontStyle: 'italic',
              color: BRAND.amber,
              textAlign: 'center',
              paddingLeft: 60,
              paddingRight: 60,
              lineHeight: 1.35,
              textShadow: `0 4px 30px ${BRAND.dark}, 0 0 60px ${BRAND.dark}CC`,
            }}
          >
            {slogan || 'Every photo tells their story.'}
          </div>
          <div
            style={{
              marginTop: 20,
              fontFamily: playfair,
              fontSize: 28,
              fontWeight: 400,
              color: BRAND.textLight,
              letterSpacing: 3,
              textTransform: 'uppercase',
              textShadow: `0 2px 20px ${BRAND.dark}`,
            }}
          >
            {brand.name}
          </div>
        </div>
      )}

      {/* === HOOK TEXT (delayed to start after slogan; moves to top when the phone plays below) === */}
      <HookText
        text={hookText}
        startFrame={HOOK_START_FRAME}
        endFrame={timing.hookEnd}
        fontSize={52}
        position={phoneSearch ? 'top' : 'center'}
        {...(hookTeaser !== undefined ? { teaser: hookTeaser } : {})}
      />

      {/* === PHONE SEARCH SEQUENCE (optional hook visual) === */}
      {phoneSearch && (
        <PhoneSearchHook
          {...phoneSearch}
          startFrame={sloganIntroDuration - 5}
          endFrame={timing.hookEnd}
        />
      )}

      {/* === TIP CARDS === */}
      {tips.map((tip, i) => (
        <TipCard
          key={i}
          tipTitle={tip.tipTitle}
          tipBody={tip.tipBody}
          tipImageSrc={tip.tipImageSrc}
          tipImages={tip.tipImages}
          tipIcon={tip.tipIcon}
          tipVisual={tip.tipVisual}
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

          {/* Recap: tip icons pop back in with checkmarks */}
          {tips.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 28, marginTop: 36 }}>
              {tips.map((tip, i) => {
                const popStart = timing.takeawayStart + 18 + i * 8;
                const pop = interpolate(frame, [popStart, popStart + 6, popStart + 12], [0, 1.15, 1]);
                const on = interpolate(frame, [popStart, popStart + 6], [0, 1]);
                return (
                  <div
                    key={i}
                    style={{
                      position: 'relative',
                      width: 96,
                      height: 96,
                      borderRadius: 26,
                      background: `${BRAND.amber}22`,
                      border: `2px solid ${BRAND.amber}66`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 46,
                      opacity: on,
                      transform: `scale(${pop})`,
                    }}
                  >
                    {/* ponytail: the tip's number, not a fallback bulb. Without
                        icons every recap chip was an identical 💡 — and a digit
                        is language-neutral, which an emoji only pretends to be. */}
                    {tip.tipIcon || i + 1}
                    <span style={{ position: 'absolute', bottom: -12, right: -12, fontSize: 34 }}>✅</span>
                  </div>
                );
              })}
            </div>
          )}
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
    </BrandProvider>
  );
};

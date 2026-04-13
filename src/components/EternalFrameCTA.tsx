import React from 'react';
import { useCurrentFrame, Img, staticFile } from 'remotion';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { BRAND, interpolate } from '../config';

const { fontFamily: playfair } = loadPlayfair();
const { fontFamily: inter } = loadInter();

interface CTAProps {
  startFrame: number;
  endFrame: number;
  slogan?: string;
}

const DEFAULT_SLOGAN = 'Honor them in every pixel.';

export const EternalFrameCTA: React.FC<CTAProps> = ({
  startFrame,
  endFrame,
  slogan = DEFAULT_SLOGAN,
}) => {
  const frame = useCurrentFrame();
  const f = frame - startFrame; // frames since CTA started

  if (frame < startFrame || frame > endFrame) return null;

  // === Staggered entrance animations ===

  // Logo: fade + scale (frames 0-10)
  const logoOpacity = interpolate(frame, [startFrame, startFrame + 10], [0, 1]);
  const logoScale = interpolate(frame, [startFrame, startFrame + 12], [0.7, 1]);

  // App name: fade + slide up (frames 5-15)
  const nameOpacity = interpolate(frame, [startFrame + 5, startFrame + 15], [0, 1]);
  const nameSlide = interpolate(frame, [startFrame + 5, startFrame + 15], [30, 0]);

  // Slogan: fade in (frames 10-20)
  const sloganOpacity = interpolate(frame, [startFrame + 10, startFrame + 20], [0, 1]);

  // App Store badge: fade + slide up (frames 18-28)
  const badgeOpacity = interpolate(frame, [startFrame + 18, startFrame + 28], [0, 1]);
  const badgeSlide = interpolate(frame, [startFrame + 18, startFrame + 28], [25, 0]);

  // Badge subtle pulse after entrance
  const badgePulse = f > 35
    ? 1 + 0.015 * Math.sin((f - 35) * 0.12)
    : 1;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 45%, ${BRAND.coral}15 0%, ${BRAND.teal}08 40%, transparent 70%)`,
          opacity: logoOpacity,
        }}
      />

      {/* Content container */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          zIndex: 1,
        }}
      >
        {/* App icon */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            overflow: 'hidden',
            marginBottom: 28,
            boxShadow: `0 12px 48px rgba(0,0,0,0.5), 0 0 60px ${BRAND.coral}25`,
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        >
          <Img
            src={staticFile('eternalframe-logo.jpg')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        </div>

        {/* App name */}
        <div
          style={{
            fontFamily: playfair,
            fontSize: 56,
            fontWeight: 700,
            color: BRAND.white,
            letterSpacing: -1,
            marginBottom: 12,
            opacity: nameOpacity,
            transform: `translateY(${nameSlide}px)`,
          }}
        >
          EternalFrame
        </div>

        {/* AI-generated slogan */}
        <div
          style={{
            fontFamily: playfair,
            fontSize: 32,
            fontWeight: 400,
            fontStyle: 'italic',
            color: BRAND.amber,
            letterSpacing: 0.5,
            marginBottom: 48,
            opacity: sloganOpacity,
            textAlign: 'center',
            paddingLeft: 60,
            paddingRight: 60,
          }}
        >
          {slogan}
        </div>

        {/* App Store badge */}
        <div
          style={{
            opacity: badgeOpacity,
            transform: `translateY(${badgeSlide}px) scale(${badgePulse})`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: '#000000',
              border: '1.5px solid #A2A2A6',
              borderRadius: 16,
              paddingLeft: 20,
              paddingRight: 28,
              paddingTop: 12,
              paddingBottom: 12,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          >
            {/* Apple logo SVG */}
            <svg
              width="36"
              height="44"
              viewBox="0 0 814 1000"
              fill="white"
            >
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.5-81.5-105.9-208.5-105.9-330.8 0-194.3 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8.7 15.6 1.3 18.2 2.6.4 6.5 1.3 10.4 1.3 45.3 0 102.5-30.4 139.3-71.4z" />
            </svg>

            {/* Text */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontFamily: inter,
                  fontSize: 16,
                  fontWeight: 400,
                  color: '#FFFFFF',
                  lineHeight: 1,
                  letterSpacing: 0.3,
                }}
              >
                Download on the
              </span>
              <span
                style={{
                  fontFamily: inter,
                  fontSize: 30,
                  fontWeight: 600,
                  color: '#FFFFFF',
                  lineHeight: 1.2,
                  letterSpacing: 0.5,
                }}
              >
                App Store
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

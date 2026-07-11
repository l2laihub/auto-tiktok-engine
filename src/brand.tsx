import React, { createContext, useContext } from 'react';
import { BRAND } from './config';

// Per-client branding, passed as the optional `brand` input prop on both
// compositions. Everything defaults to EternalFrame so the existing pipeline
// is unaffected. Palette keys keep their EternalFrame names; read them as
// roles: coral = primary accent, teal = secondary accent, amber = highlight /
// badges, dark/darkSurface = backgrounds.
export interface BrandProps {
  colors?: Partial<typeof BRAND>;
  /** Business name shown in the intro watermark and CTA. */
  name?: string;
  /** Logo image: http(s) URL or a path under public/. Empty string hides the logo. */
  logoSrc?: string;
  /** CTA pill text (e.g. "📞 (206) 937-0755 · Walk-ins welcome"). Unset = App Store badge. */
  cta?: string;
  /** Website shown under the CTA pill (e.g. "nknailsseattle.com"). Unset = hidden. */
  website?: string;
  /** Badge over the "after" image in reveals. Default "Restored ✦". */
  afterLabel?: string;
}

export interface Brand {
  colors: typeof BRAND;
  name: string;
  logoSrc: string;
  cta?: string;
  website?: string;
  afterLabel: string;
}

export const DEFAULT_BRAND: Brand = {
  colors: BRAND,
  name: 'EternalFrame',
  logoSrc: 'eternalframe-logo.jpg',
  afterLabel: 'Restored ✦',
};

export function resolveBrand(props?: BrandProps): Brand {
  if (!props) return DEFAULT_BRAND;
  return {
    ...DEFAULT_BRAND,
    ...props,
    colors: { ...BRAND, ...props.colors },
  };
}

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

export const BrandProvider = BrandContext.Provider;

export function useBrand(): Brand {
  return useContext(BrandContext);
}

/**
 * Design tokens.
 *
 * These are the *same* values as `apps/web/src/styles/globals.css`, converted
 * from the `r g b` triples Tailwind consumes into hex. That is deliberate: a
 * parent who checks the fee balance on the web portal and then on the phone
 * should be looking at one product, not two that happen to share a logo.
 *
 * Both themes define every colour. Nothing is declared only inside the dark
 * block — a token that exists in one theme and not the other is how a screen
 * ends up with black text on a black card at 9pm.
 */

export interface Palette {
  /** Brand ramp. 500 is the accent; the ramp inverts in dark so contrast holds. */
  brand50: string;
  brand100: string;
  brand200: string;
  brand300: string;
  brand400: string;
  brand500: string;
  brand600: string;
  brand700: string;

  /** Surfaces carry a trace of the brand hue rather than being neutral grey. */
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  hairline: string;

  ink: string;
  inkMuted: string;
  inkSubtle: string;
  /** Text that sits on top of a brand-filled surface. */
  onBrand: string;

  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;

  /** Scrim behind sheets and over map imagery. */
  scrim: string;
  /** Elevation shadow colour; heavier in light, near-invisible in dark. */
  shadow: string;
}

export const lightPalette: Palette = {
  brand50: '#EEF2FF',
  brand100: '#E0E7FF',
  brand200: '#C7D2FE',
  brand300: '#A5B4FC',
  brand400: '#818CF8',
  brand500: '#6366F1',
  brand600: '#4F46E5',
  brand700: '#4338CA',

  canvas: '#F7F8FC',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#F1F3F9',
  hairline: '#E2E6F0',

  ink: '#11182A',
  inkMuted: '#525D75',
  inkSubtle: '#8E98AD',
  onBrand: '#FFFFFF',

  success: '#16A34A',
  successSoft: '#F0FDF4',
  warning: '#D97706',
  warningSoft: '#FFFBEB',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  info: '#0284C7',
  infoSoft: '#F0F9FF',

  scrim: 'rgba(15, 23, 42, 0.45)',
  shadow: '#0F172A',
};

/**
 * Dark is built from a navy base, not black. Pure black surfaces make
 * elevation impossible to read and cause halation against light text; a
 * blue-shifted charcoal keeps cards visibly stacked above the canvas.
 */
export const darkPalette: Palette = {
  brand50: '#1E1B4B',
  brand100: '#312E81',
  brand200: '#3730A3',
  brand300: '#4338CA',
  brand400: '#6366F1',
  brand500: '#818CF8',
  brand600: '#8B94FA',
  brand700: '#A5B4FC',

  canvas: '#090C17',
  surface: '#111626',
  surfaceRaised: '#181F33',
  surfaceSunken: '#0D111F',
  hairline: '#28324A',

  ink: '#EDF2FA',
  inkMuted: '#A0ADC4',
  inkSubtle: '#6E7D96',
  onBrand: '#0B1020',

  success: '#4ADE80',
  successSoft: '#0C2718',
  warning: '#FBBF24',
  warningSoft: '#2A1E06',
  danger: '#F87171',
  dangerSoft: '#2C1113',
  info: '#38BDF8',
  infoSoft: '#08243A',

  scrim: 'rgba(2, 6, 16, 0.68)',
  shadow: '#000000',
};

/**
 * A 4pt base scale. Every margin and padding in the app comes from here, which
 * is what makes unrelated screens feel like they were laid out by one person.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 56,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 26,
  pill: 999,
} as const;

/**
 * Type scale. Line heights are set explicitly rather than left to a multiplier
 * because Android and iOS round them differently, and a list row that is 1px
 * taller on one platform is a list that scrolls out of sync with its header.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 38, letterSpacing: -0.8, fontWeight: '700' },
  title1: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5, fontWeight: '700' },
  title2: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3, fontWeight: '700' },
  title3: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: 0, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, letterSpacing: 0, fontWeight: '600' },
  callout: { fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, letterSpacing: 0, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 15, letterSpacing: 0.3, fontWeight: '600' },
  /** Tabular figures for money and counts, so columns line up. */
  numeric: { fontSize: 22, lineHeight: 28, letterSpacing: -0.4, fontWeight: '700' },
} as const;

export type TypographyVariant = keyof typeof typography;

/**
 * Layered, low-opacity elevation. One heavy drop shadow reads as cheap; two
 * soft ones stacked read as depth. RN only gives us a single shadow per view,
 * so these are tuned to be the *softer* of the pair the web uses.
 */
export const elevation = {
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  sm: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  lg: {
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
} as const;

/** Motion. Short and consistent; anything over 300ms feels sluggish on a phone. */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
} as const;

/**
 * Minimum touch target. Below this, a bus driver wearing gloves misses the
 * boarding button, which is a real failure and not a style preference.
 */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = 44;

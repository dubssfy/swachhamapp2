// Swachham App - Theme Constants
// Production-ready theme configuration

export const COLORS = {
  Primary: '#2D6A4F',
  PrimaryLight: '#52B788',
  PrimaryDark: '#1B4332',
  Accent: '#95D5B2',
  Background: '#F8FFF9',
  Surface: '#FFFFFF',
  TextPrimary: '#1B1B1B',
  TextSecondary: '#6B7280',
  Success: '#40916C',
  Error: '#E63946',
  Warning: '#F77F00',
  Info: '#3B82F6',
  Border: '#E5E7EB',
  transparent: 'transparent',
} as const;

/**
 * THE CUSTOMER PALETTE.
 *
 * #3d6173 (slate blue) and #ffbd4a (amber), as specified. Everything else
 * here is derived from those two so the screens have the neutrals, tints and
 * text colours a real screen needs without inventing a third hue.
 *
 * SEPARATE FROM `COLORS` ON PURPOSE. `COLORS` is the Swachham green, and it
 * is imported by the business, sorter, rider, manager and super-admin screens
 * too -- recolouring it would repaint the entire app rather than the customer
 * side. Only the customer screens import this.
 *
 * WHICH COLOUR DOES WHAT:
 *
 *   Primary   #3d6173  structure -- headers, primary buttons, body emphasis.
 *   Accent    #ffbd4a  the one thing on screen that should be looked at --
 *                      price, the call to action, the selected chip.
 *
 * They are used that way round because amber on white does not carry enough
 * contrast for body text or for white-on-amber labels (about 1.9:1), while
 * slate blue does. Amber therefore appears as a fill behind DARK text, or as
 * a small accent, never as the colour of small white text.
 *
 * `Background` is a warm off-white tinted towards the amber rather than plain
 * grey, so the accent looks like it belongs to the page instead of sitting on
 * top of it.
 */
export const CUSTOMER_COLORS = {
  /** #3d6173 — the structural colour. */
  Primary: '#3D6173',
  /** A lift for gradients and pressed states. */
  PrimaryLight: '#5A8093',
  /** Headings and anything that must read as strongly as text. */
  PrimaryDark: '#2A4553',
  /** A wash of the primary, for chips and icon tiles. */
  PrimarySoft: '#E4ECF0',

  /** #ffbd4a — the accent. Behind dark text, never behind small white text. */
  Accent: '#FFBD4A',
  /** Pressed / border state for the accent. */
  AccentDark: '#E0A231',
  /** The accent at page strength, for banners and highlight cards. */
  AccentSoft: '#FFF3DC',

  /** Warm off-white, tinted towards the accent. */
  Background: '#FBF8F3',
  Surface: '#FFFFFF',
  /** A card that should sit apart from the page without a border. */
  SurfaceAlt: '#F4EFE7',

  TextPrimary: '#1F2E36',
  TextSecondary: '#6B7B84',
  /** Text and icons drawn ON the Primary. */
  OnPrimary: '#FFFFFF',
  /** Text and icons drawn ON the Accent. Dark, for contrast. */
  OnAccent: '#3D2A00',

  Border: '#E3DED5',
  Success: '#2F7D5B',
  Error: '#C4442F',
  Warning: '#B4700C',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const TYPOGRAPHY = {
  fontFamily: 'System', // Fallback font, ideally load your custom font
  sizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  }
} as const;

export const BORDER_RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  full: 999,
} as const;

export const SHADOWS = {
  light: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 5,
  },
  heavy: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 10,
  }
} as const;

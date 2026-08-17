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

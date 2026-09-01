import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { DEMO_BADGE_LABEL, DEMO_MODE } from '../../demo/demoMode';

interface Props {
  /** `light` for placing on the app's green surfaces, `dark` on white. */
  tone?: 'light' | 'dark';
  style?: any;
}

/**
 * The small "BUSINESS DEMO" pill.
 *
 * DELIBERATELY QUIET. It has to be legible enough that nobody mistakes the
 * demo for a live account, and small enough that hotel management is looking
 * at the product rather than at a warning banner — so it is a 10pt letter-
 * spaced pill in the app's own palette, not a coloured strip across the page.
 *
 * It renders NOTHING outside a demo build, so leaving one on a production
 * screen is harmless: `DEMO_MODE` is false there and the component returns
 * null before anything is laid out.
 */
export default function DemoBadge({ tone = 'dark', style }: Props) {
  if (!DEMO_MODE) return null;

  return (
    <View
      style={[styles.badge, tone === 'light' ? styles.badgeLight : styles.badgeDark, style]}
      accessibilityRole="text"
      accessibilityLabel="This is a demonstration version of the app"
    >
      <Text style={[styles.text, tone === 'light' ? styles.textLight : styles.textDark]}>
        {DEMO_BADGE_LABEL}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
  },
  badgeDark: {
    backgroundColor: '#EAF4EE',
    borderColor: COLORS.Accent,
  },
  badgeLight: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.55)',
  },
  text: {
    fontSize: 10,
    letterSpacing: 1.1,
    fontWeight: '700',
  },
  textDark: {
    color: COLORS.PrimaryDark,
  },
  textLight: {
    color: COLORS.Surface,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Optional element rendered at the far right (e.g. a cart button). */
  action?: React.ReactNode;
}

/**
 * Shared Business header. The Swachham logo sits in the TOP-LEFT corner, the
 * title follows it, and any action sits on the right. Uses the existing
 * assets/logo.png — no new asset is introduced.
 *
 * The logo has a fixed box with resizeMode="contain", so its aspect ratio is
 * preserved and it cannot overlap the title on narrow screens (the title wrap
 * flexes and truncates instead).
 */
export default function BusinessHeader({ title, subtitle, onBack, action }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../../../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Swachham"
      />

      {onBack ? (
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    backgroundColor: COLORS.Background,
  },
  // Fixed box + contain keeps the aspect ratio and stops overlap.
  logo: { width: 40, height: 40, borderRadius: BORDER_RADIUS.sm },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.light,
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  subtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
});

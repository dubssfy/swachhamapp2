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
 * Shared Business header, used by every Business screen so branding and
 * spacing stay identical across the section.
 *
 * Top-left is the brand lockup: the Swachham logo followed by the wordmark.
 * The screen title sits on the row below it, so a long title can never crowd
 * or wrap into the branding. Any action (cart, etc.) sits at the right of the
 * brand row.
 *
 * The logo has a fixed box with resizeMode="contain", so its aspect ratio is
 * preserved on every screen size.
 */
export default function BusinessHeader({ title, subtitle, onBack, action }: Props) {
  return (
    <View style={styles.container}>
      {/* Brand lockup — identical on every Business page. */}
      <View style={styles.brandRow}>
        <Image
          source={require('../../../assets/swachham-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
        <Text style={styles.brandText}>Swachham</Text>

        <View style={styles.brandSpacer} />
        {action}
      </View>

      <View style={styles.titleRow}>
        {onBack ? (
          <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={20} color={COLORS.TextPrimary} />
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    backgroundColor: COLORS.Background,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  // Fixed box + contain keeps the aspect ratio on every screen size.
  logo: { width: 34, height: 34, borderRadius: BORDER_RADIUS.sm },
  brandText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    color: COLORS.PrimaryDark,
    letterSpacing: 0.3,
  },
  brandSpacer: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
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

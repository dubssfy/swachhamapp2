import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';

interface Props {
  /**
   * Optional so a screen that carries its own heading below this one — a
   * `SectionHeading` pill, say — is not forced into showing the same name
   * twice. The row below the banner always renders (it holds Back and HOME);
   * when there is no title it simply has no text between the two buttons.
   */
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  /** Optional element rendered at the far right (e.g. a cart button). */
  action?: React.ReactNode;
}

/**
 * Shared Business header, used by every Business screen so branding and
 * spacing stay identical across the section.
 *
 * Top-left is the Swachham logo on its own — the mark already carries the
 * wordmark, so a separate text label beside it would only repeat it. The
 * screen title sits on the row below, so a long title can never crowd the
 * branding. Any action (cart, etc.) sits at the right of the brand row.
 *
 * The logo has a fixed box with resizeMode="contain", so its aspect ratio is
 * preserved on every screen size.
 *
 * BACK IS A LABELLED PILL, NOT A BARE CHEVRON. It is the one control on the
 * page whose meaning has to be obvious at a glance, and an unlabelled 36px
 * circle is neither obvious nor a comfortable target. Icon plus the word
 * "Back", at a 48px minimum height, and it is defined HERE so every Business
 * screen gets the same one — a per-screen back button is how they drifted into
 * different sizes in the first place.
 */
export default function BusinessHeader({ title, subtitle, onBack, action }: Props) {
  const navigation = useNavigation<any>();

  /**
   * Jumps straight to the Home page. The catalogue screens this header sits on
   * are mounted in the Business tabs for a business user and in the Customer
   * stack for a customer, so the route differs — walk to the root to see which
   * section is live and target its Home.
   */
  const goHome = () => {
    let nav: any = navigation;
    while (nav.getParent?.()) nav = nav.getParent();
    const roots: string[] = nav.getState?.()?.routeNames ?? [];
    if (roots.includes('Business')) {
      navigation.navigate('BusinessHome', { screen: 'HomeScreen' });
    } else {
      navigation.navigate('MainTab', { screen: 'Home' });
    }
  };

  return (
    <View style={styles.container}>
      {/* Brand banner — full width edge-to-edge on Android with transparent background */}
      <View style={styles.brandBannerRow}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.brandBanner}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
        {action ? <View style={styles.actionWrap}>{action}</View> : null}
      </View>

      {/* Back on the left (unchanged), HOME on the right of the same row. The
          spacer keeps HOME hard right when there is no title between them. */}
      <View style={styles.titleRow}>
        {onBack ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            // A generous slop so the tap lands even when the thumb does not.
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.PrimaryDark} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        ) : null}

        {title ? (
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
        ) : (
          <View style={styles.titleSpacer} />
        )}

        <TouchableOpacity
          style={styles.homeButton}
          onPress={goHome}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go to Home"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="home-outline" size={20} color={COLORS.PrimaryDark} />
          <Text style={styles.homeText}>HOME</Text>
        </TouchableOpacity>
      </View>

      {/* The same hairline the Home page carries under its header, in the same
          position, now on every Business page. */}
      <View style={styles.topDivider} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: COLORS.Background,
    paddingBottom: SPACING.xs,
  },
  brandBannerRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: 'transparent',
  },
  brandBanner: {
    width: '100%',
    height: 70,
  },
  actionWrap: {
    position: 'absolute',
    right: SPACING.md,
    top: SPACING.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.xs,
  },
  titleSpacer: { flex: 1 },
  // Mirrors backButton exactly, so HOME sits level with Back on the same row.
  homeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    borderWidth: 1.5,
    borderColor: COLORS.Primary,
    ...SHADOWS.light,
  },
  homeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.PrimaryDark,
  },
  // Same hairline as the Home page's header divider (height, colour, offset).
  topDivider: {
    height: 1,
    backgroundColor: COLORS.Border,
    marginTop: SPACING.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    borderWidth: 1.5,
    borderColor: COLORS.Primary,
    ...SHADOWS.light,
  },
  backText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.PrimaryDark,
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

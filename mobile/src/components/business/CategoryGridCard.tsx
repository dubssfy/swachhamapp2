import React, { useRef } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Text,
  Animated,
  Pressable,
  type ImageSourcePropType,
  type ImageResizeMode,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';

interface Props {
  /** Used as the accessibility label — never rendered as visible text. */
  name: string;
  /** Bundled artwork; when absent the icon fallback is used instead. */
  source?: ImageSourcePropType | null;
  /** Icon shown when there is no artwork, so a card is never blank. */
  fallbackIcon: keyof typeof Ionicons.glyphMap;
  /** Card edge length, computed by the grid from the screen it has to fill. */
  size: number;
  /**
   * `cover` (default) for artwork designed to fill the square card. Pass
   * `contain` only for artwork whose lettering would otherwise be cropped.
   */
  resizeMode?: ImageResizeMode;
  onPress: () => void;
  onLongPress?: () => void;
}

/**
 * One square card in a 2-column category grid.
 *
 * The artwork IS the card: it fills the whole square, and there is no name
 * strip, caption or button beneath it. Category names live inside the artwork
 * itself, so rendering them again would duplicate the text.
 *
 * The name is still passed through as the accessibility label, which is what
 * a screen reader announces now that no visible text remains.
 */
export default function CategoryGridCard({
  name,
  source,
  fallbackIcon,
  size,
  resizeMode = 'cover',
  onPress,
  onLongPress,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();

  return (
    <Animated.View style={{ transform: [{ scale }], width: size }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => press(0.96)}
        onPressOut={() => press(1)}
        accessibilityRole="button"
        accessibilityLabel={name}
        // Square, with the image clipped to the rounded corners.
        style={[styles.card, { width: size, height: size }]}
      >
        {source ? (
          <Image source={source} style={styles.image} resizeMode={resizeMode} />
        ) : (
          // No artwork yet: a themed tile with an icon and the name, so the
          // card is still identifiable rather than blank.
          <View style={styles.fallback}>
            <Ionicons name={fallbackIcon} size={44} color={COLORS.Primary} />
            <Text style={styles.fallbackName} numberOfLines={2}>
              {name}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    ...SHADOWS.medium,
  },
  image: { width: '100%', height: '100%' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.Accent + '25',
  },
  fallbackName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.PrimaryDark,
    textAlign: 'center',
  },
});

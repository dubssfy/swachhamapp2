import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { useChatStore } from '../../store/chatStore';

/**
 * The Swachham assistant launcher.
 *
 * A round floating button in the bottom-right corner carrying the Swachham
 * delivery artwork exactly as supplied — the same asset the order
 * confirmation uses — drawn with `resizeMode="contain"` inside the circle, so
 * it is never cropped, stretched or substituted for an icon.
 *
 * It sits well clear of the bottom bar and the safe-area inset, so it covers
 * no control. The greeting appears once per session, tracked in the chat
 * store rather than here: remounting this screen does not bring it back.
 */

const GREETING_DELAY_MS = 600;

/** Diameter of the round button. */
const BUTTON_SIZE = 66;

interface Props {
  /**
   * How far above the screen's own bottom edge the button sits.
   *
   * The tab navigator reserves the bar's height, so this screen already ends
   * above the bar and above the system inset — the offset is measured from
   * there, and a small one is enough to clear it. A screen with a different
   * bottom bar can pass its own.
   */
  bottomOffset?: number;
}

export default function SwachhamChatLauncher({ bottomOffset = 8 }: Props) {
  const openChat = useChatStore((state) => state.open);
  const isChatOpen = useChatStore((state) => state.isOpen);
  const greetingShown = useChatStore((state) => state.greetingShown);
  const markGreetingShown = useChatStore((state) => state.markGreetingShown);

  const [showGreeting, setShowGreeting] = useState(false);
  const bubble = useRef(new Animated.Value(0)).current;

  // Says hello shortly after the page settles — once for the whole session.
  useEffect(() => {
    if (greetingShown) return;
    markGreetingShown();

    const timer = setTimeout(() => {
      setShowGreeting(true);
      Animated.timing(bubble, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, GREETING_DELAY_MS);

    return () => clearTimeout(timer);
  }, [bubble, greetingShown, markGreetingShown]);

  // Opening the chat retires the greeting — it has done its job.
  useEffect(() => {
    if (isChatOpen) setShowGreeting(false);
  }, [isChatOpen]);

  return (
    <View style={[styles.wrap, { bottom: bottomOffset }]} pointerEvents="box-none">
      {showGreeting ? (
        <Animated.View
          style={[
            styles.bubble,
            {
              opacity: bubble,
              transform: [
                { scale: bubble.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
              ],
            },
          ]}
        >
          <TouchableOpacity
            style={styles.bubbleClose}
            onPress={() => setShowGreeting(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss greeting"
            hitSlop={8}
          >
            <Ionicons name="close" size={14} color={COLORS.TextSecondary} />
          </TouchableOpacity>
          <Text style={styles.bubbleTitle}>Hi! I am Swachham 👋</Text>
          <Text style={styles.bubbleText}>How can I help you?</Text>
          <View style={styles.bubbleTail} />
        </Animated.View>
      ) : null}

      <View style={styles.buttonColumn}>
        <TouchableOpacity
          style={styles.button}
          onPress={openChat}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Chat with Swachham"
        >
          {/* The supplied artwork, unaltered: contained inside the circle so
              every proportion survives. */}
          <Image
            source={require('../../../assets/delivery-scooter.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </TouchableOpacity>

        {/* Says what the circle is, so it reads as a chatbot at a glance. */}
        <View style={styles.labelPill}>
          <Text style={styles.label}>Chat with Swachham</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Pinned bottom-right, above the bar. `box-none` so the page behind it
  // stays scrollable and tappable everywhere the button is not.
  wrap: {
    position: 'absolute',
    right: SPACING.md,
    alignItems: 'flex-end',
    gap: SPACING.sm,
    zIndex: 20,
  },

  buttonColumn: { alignItems: 'center', gap: 4 },
  // Fully round: half the diameter is what makes it a circle in React Native.
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: COLORS.Surface,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    ...SHADOWS.medium,
  },
  // Contained inside the circle, so the landscape artwork keeps its shape.
  logo: { width: BUTTON_SIZE - 10, height: BUTTON_SIZE - 22 },
  labelPill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.Surface,
    borderWidth: 1,
    borderColor: '#ffbd4a',
    ...SHADOWS.light,
  },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
    textAlign: 'center',
  },

  bubble: {
    maxWidth: 230,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingRight: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    borderBottomRightRadius: BORDER_RADIUS.xs,
    backgroundColor: COLORS.Surface,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  bubbleTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  bubbleText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  bubbleClose: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The little nub pointing down at the button.
  bubbleTail: {
    position: 'absolute',
    right: 28,
    bottom: -6,
    width: 12,
    height: 12,
    backgroundColor: COLORS.Surface,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.Border,
    transform: [{ rotate: '45deg' }],
  },
});

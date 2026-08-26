import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { notchGeometry, buildBarPath, NOTCH_DEPTH, BAR_RADIUS } from './tabBarNotch';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const ACTIVE_COLOR = '#2E7D32';
const INACTIVE_COLOR = '#777';

const BAR_HEIGHT = 72;

/* =====================================================================
 * THE NOTCHED BAR
 *
 * The panel is drawn as an SVG path rather than a styled View, because a
 * concave scoop is not something a border radius can express: `borderRadius`
 * only ever rounds a corner outwards. The path runs along the top edge, dips
 * through a smooth curve at the centre and carries on, so the bar has a real
 * notch the logo sits INSIDE rather than a circle floating on a straight edge.
 *
 * The geometry itself lives in `tabBarNotch.ts` — pure, with no React Native
 * imports — so the curve can be measured on its own rather than eyeballed on
 * one phone. See `backend/scripts/smoke_tab_bar_notch.ts`, which checks across
 * device widths that the scoop never reaches an icon and never covers the icon
 * row.
 *
 * Both tab sets have four tabs, so the centre falls in the gap between tab 2
 * and tab 3 and the notch never lands on an icon.
 * ===================================================================== */

/** Diameter of the circular logo plate that sits in the notch. */
const BADGE_SIZE = 56;
const BADGE_IMAGE_SIZE = 34;
/**
 * How far the plate's top sits ABOVE the bar's edge, and therefore how much
 * transparent headroom the host reserves for it. Roughly a third stays proud
 * of the bar; the rest nests in the scoop.
 */
const BADGE_RAISE = 32;

/**
 * Icons and labels are keyed by route name. Both tab sets are listed, so the
 * same bar serves the Customer tabs (Home/Orders/Cart/Profile) and the
 * Business tabs (BusinessHome/...) without a second component.
 */
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Orders: 'receipt-outline',
  Cart: 'bag-handle-outline',
  Profile: 'person-outline',
  BusinessHome: 'home-outline',
  BusinessOrders: 'receipt-outline',
  BusinessCart: 'bag-handle-outline',
  BusinessProfile: 'person-outline',
};

const ACTIVE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Orders: 'receipt',
  Cart: 'bag-handle',
  Profile: 'person',
  BusinessHome: 'home',
  BusinessOrders: 'receipt',
  BusinessCart: 'bag-handle',
  BusinessProfile: 'person',
};

const LABELS: Record<string, string> = {
  BusinessHome: 'Home',
  BusinessOrders: 'Orders',
  BusinessCart: 'Cart',
  BusinessProfile: 'Profile',
};

interface TabItemProps {
  routeName: string;
  label: string;
  isFocused: boolean;
  width: number;
  accessibilityLabel?: string;
  onPress: () => void;
  onLongPress: () => void;
}

/**
 * One tab. Extracted into its own component because each tab owns two
 * animations — inside the routes .map() those hooks would be called in a loop,
 * which breaks the rules of hooks the moment the tab count changes.
 */
function TabItem({
  routeName,
  label,
  isFocused,
  width,
  accessibilityLabel,
  onPress,
  onLongPress,
}: TabItemProps) {
  const scale = useRef(new Animated.Value(isFocused ? 1.18 : 1)).current;
  const translateY = useRef(new Animated.Value(isFocused ? -5 : 0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: isFocused ? 1.18 : 1,
      useNativeDriver: true,
      damping: 12,
      stiffness: 220,
    }).start();

    Animated.spring(translateY, {
      toValue: isFocused ? -5 : 0,
      useNativeDriver: true,
      damping: 14,
      stiffness: 200,
    }).start();
  }, [isFocused, scale, translateY]);

  const icon = isFocused
    ? ACTIVE_ICONS[routeName] || 'ellipse'
    : ICONS[routeName] || 'ellipse-outline';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel || label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.tab, { width }]}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale }, { translateY }] }]}>
        <View style={[styles.iconGlass, isFocused && styles.activeIconGlass]}>
          <Ionicons
            name={icon}
            size={isFocused ? 27 : 25}
            color={isFocused ? ACTIVE_COLOR : INACTIVE_COLOR}
          />
        </View>

        <Text
          style={[
            styles.label,
            {
              color: isFocused ? ACTIVE_COLOR : INACTIVE_COLOR,
              fontWeight: '700',
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Solid white bottom bar.
 *
 * The panel runs the full width of the screen and sits flush against the
 * bottom, with only its top corners rounded, and it extends behind the system
 * navigation inset so no strip of background shows beneath it.
 *
 * Its host View is a normal (non-absolute) box that reserves the bar's height.
 * That is what stops the last row of a list disappearing underneath it.
 */
export default function LiquidGlassTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Edge to edge: the panel is as wide as the screen.
  const barWidth = width;
  const tabCount = Math.max(state.routes.length, 1);
  // One slot per tab — the slot width, not a quarter of it.
  const tabWidth = barWidth / tabCount;

  // The white extends behind the gesture bar / nav bar rather than floating
  // above it, so the padding is the real inset with no artificial gap.
  const bottomInset = insets.bottom;

  // Recomputed with the width, so a rotation or a fold resizes the notch
  // instead of leaving it off-centre.
  const notch = useMemo(() => notchGeometry(barWidth, tabWidth), [barWidth, tabWidth]);

  const indicatorX = useRef(new Animated.Value(state.index * tabWidth)).current;
  const bubbleWidth = useMemo(() => Math.max(tabWidth - 10, 40), [tabWidth]);

  useEffect(() => {
    Animated.spring(indicatorX, {
      toValue: state.index * tabWidth + (tabWidth - bubbleWidth) / 2,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
      mass: 0.7,
    }).start();
  }, [state.index, tabWidth, bubbleWidth, indicatorX]);

  return (
    <View
      style={[
        styles.host,
        { height: BAR_HEIGHT + bottomInset + BADGE_RAISE, paddingBottom: bottomInset },
      ]}
    >
      <View
        style={[
          styles.bar,
          { width: barWidth, height: BAR_HEIGHT + bottomInset, paddingBottom: bottomInset },
        ]}
      >
        {/* The panel itself, drawn as a path so the centre can be scooped.
            Behind everything and non-interactive: it is purely the surface
            the tabs sit on. */}
        <Svg
          pointerEvents="none"
          width={barWidth}
          height={BAR_HEIGHT + bottomInset}
          style={StyleSheet.absoluteFill}
        >
          <Path
            d={buildBarPath(barWidth, BAR_HEIGHT + bottomInset, notch.centre, notch.half)}
            fill="#FFFFFF"
            stroke="#ffbd4a"
            strokeWidth={1.5}
          />
        </Svg>

        {/* The bubble that slides under the active tab. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeBubble,
            { width: bubbleWidth, transform: [{ translateX: indicatorX }] },
          ]}
        >
          <View style={styles.innerHighlight} />
        </Animated.View>

        <View style={styles.tabs}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : options.title ?? LABELS[route.name] ?? route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };

            return (
              <TabItem
                key={route.key}
                routeName={route.name}
                label={label}
                isFocused={isFocused}
                width={tabWidth}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            );
          })}
        </View>
      </View>

      {/* Swachham brand mark, seated IN the scoop.
          It lives in the host rather than in the bar because the bar would
          clip it: the plate is deliberately larger than the notch is deep, so
          it nests in the curve with its top third proud of the bar's edge.
          `pointerEvents="none"` keeps it decorative — the tabs beneath it stay
          fully tappable, and the notch sits in the gap between tab 2 and tab 3
          in any case. */}
      <View pointerEvents="none" style={styles.brandBadgeWrap}>
        <View style={styles.brandBadge}>
          <Image
            source={require('../../assets/swachham-logo1.png')}
            style={styles.brandBadgeImage}
            resizeMode="contain"
            accessibilityLabel="Swachham"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A normal box in the layout: the navigator reserves this height, so screen
  // content ends above the bar instead of scrolling behind it.
  host: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },

  // Edge-to-edge white panel, rounded at the top two corners only and flush
  // with the bottom of the screen. The shadow is cast upwards, so the bar
  // lifts off the content above it.
  /*
   * NO backgroundColor and NO borderRadius here: the white surface and the
   * rounded top corners are both part of the SVG path now, because a View's
   * background would fill the notch straight back in.
   *
   * The shadow stays on this View — Android's elevation needs a real view to
   * lift, and the box is close enough to the path's silhouette to read right.
   */
  bar: {
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 16,
  },

  // Above the SVG surface, which is painted at the back of the bar.
  tabs: { flex: 1, flexDirection: 'row', zIndex: 3 },

  tab: { height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  tabInner: { alignItems: 'center', justifyContent: 'center' },

  // Same slide animation as before, retinted: white-on-white would have been
  // invisible against the solid panel.
  activeBubble: {
    position: 'absolute',
    left: 0,
    // Below the deepest point of the scoop, so the highlight never appears to
    // spill out of the notch.
    top: NOTCH_DEPTH + 1,
    height: 46,
    borderRadius: 22,
    backgroundColor: 'rgba(46,125,50,0.08)',
    zIndex: 1,
  },

  innerHighlight: {
    position: 'absolute',
    top: 2,
    left: 10,
    right: 10,
    height: 12,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },

  iconGlass: {
    width: 44,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  activeIconGlass: {
    backgroundColor: 'transparent',
  },

  label: { fontSize: 12, marginTop: 2, fontWeight: '700' },

  // Full-width strip so the badge is centred on any screen width. Pinned to
  // the top of the host, which is BADGE_RAISE above the bar's top edge.
  brandBadgeWrap: {
    position: 'absolute',
    top: -6,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 4,
  },

  // Circular, to match the curve it sits in — a rounded square in a round
  // scoop reads as two different shapes rather than one.
  brandBadge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 7,
    elevation: 20,
  },

  // Square box + contain: the logo is never stretched or cropped.
  brandBadgeImage: { width: BADGE_IMAGE_SIZE, height: BADGE_IMAGE_SIZE },
});

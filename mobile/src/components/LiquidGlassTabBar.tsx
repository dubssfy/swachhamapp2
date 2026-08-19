import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const ACTIVE_COLOR = '#2E7D32';
const INACTIVE_COLOR = '#777';

const BAR_HEIGHT = 84;
const SIDE_MARGIN = 16;
const BOTTOM_GAP = 10;

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
              fontWeight: isFocused ? '700' : '500',
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
 * Frosted-glass bottom bar.
 *
 * The glass panel floats with rounded corners and side margins, but its host
 * View is a normal (non-absolute) box that reserves the bar's height. That is
 * what stops the last row of a list disappearing underneath it.
 */
export default function LiquidGlassTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const barWidth = width - SIDE_MARGIN * 2;
  const tabCount = Math.max(state.routes.length, 1);
  // One slot per tab — the slot width, not a quarter of it.
  const tabWidth = barWidth / tabCount;

  const bottomInset = Math.max(insets.bottom, BOTTOM_GAP);

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
    <View style={[styles.host, { height: BAR_HEIGHT + bottomInset, paddingBottom: bottomInset }]}>
      <View style={[styles.glassContainer, { width: barWidth }]}>
        <BlurView intensity={75} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.glassOverlay} />

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

  glassContainer: {
    height: BAR_HEIGHT,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 12,
  },

  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },

  tabs: { flex: 1, flexDirection: 'row', zIndex: 3 },

  tab: { height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  tabInner: { alignItems: 'center', justifyContent: 'center' },

  activeBubble: {
    position: 'absolute',
    left: 0,
    top: 9,
    height: 66,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
    zIndex: 1,
  },

  innerHighlight: {
    position: 'absolute',
    top: 2,
    left: 10,
    right: 10,
    height: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },

  iconGlass: {
    width: 46,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  activeIconGlass: {
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },

  label: { fontSize: 12, marginTop: 3 },
});

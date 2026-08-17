import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  BusinessHome: 'home-outline',
  BusinessOrders: 'list-outline',
  BusinessCart: 'cart-outline',
  BusinessProfile: 'person-outline',
};

const LABELS: Record<string, string> = {
  BusinessHome: 'Home',
  BusinessOrders: 'Orders',
  BusinessCart: 'Cart',
  BusinessProfile: 'Profile',
};

/**
 * The Business bottom navigation. Rendered as the custom `tabBar` of the
 * Business tab navigator, so it is defined once and React Navigation owns the
 * active-tab state rather than a hand-rolled route guess.
 */
export default function BusinessFooter({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.container}>
      {state.routes.map((route, index) => {
        const isActive = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isActive && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            style={styles.tab}
            onPress={onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={isActive ? { selected: true } : {}}
            accessibilityLabel={LABELS[route.name] || route.name}
          >
            <Ionicons
              name={ICONS[route.name] || 'ellipse-outline'}
              size={24}
              color={isActive ? COLORS.Primary : COLORS.TextSecondary}
            />
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {LABELS[route.name] || route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: COLORS.Surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  labelActive: { color: COLORS.Primary, fontWeight: '700' },
});

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';

/**
 * Customer Orders tab. Replaces the previous `() => null` placeholder so the
 * Customer tab renders a real screen. Customer-only — never reads business data.
 */
export default function CustomerOrdersScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topLogoWrap}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.topLogo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>
      <Text style={styles.title}>My Orders</Text>
      <View style={styles.centered}>
        <Ionicons name="list-outline" size={48} color={COLORS.TextSecondary} />
        <Text style={styles.emptyText}>You have no orders yet.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  topLogoWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xs,
    backgroundColor: 'transparent',
  },
  topLogo: {
    width: '100%',
    height: 70,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
  },
});

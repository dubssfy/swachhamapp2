import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import { useBusinessOrderStore, LaundryType, OrderType } from '../../store/businessOrderStore';

/**
 * Order Type and Laundry Type are chosen on this single page. There is no
 * separate Standard / Quick page and no separate Laundry Type page — the two
 * order-type cards and the laundry-type choice live here, and Continue goes
 * straight to the catalogue. Service is chosen later, in the Cart.
 */
const ORDER_TYPES: Array<{
  value: OrderType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  details: string[];
}> = [
  {
    value: 'standard',
    label: 'Standard Order',
    icon: 'time-outline',
    details: [
      'Regular turnaround for planned, routine laundry',
      'Processed in the normal production queue',
      'Best for bulk linen and daily housekeeping loads',
    ],
  },
  {
    value: 'quick',
    label: 'Quick Order',
    icon: 'flash-outline',
    details: [
      'Priority handling for urgent requirements',
      'Moved to the front of the production queue',
      'Best for same-day and short-notice needs',
    ],
  },
];

const LAUNDRY_TYPES: Array<{ value: LaundryType; label: string; hint: string }> = [
  { value: 'hotel', label: 'Hotel Laundry', hint: 'Linen and property-owned items' },
  { value: 'guest', label: 'Guest Laundry', hint: 'Items belonging to your guests' },
];

export default function OrderTypeScreen({ navigation }: any) {
  const { orderType, laundryType, setOrderType, setLaundryType, saveSelections } =
    useBusinessOrderStore();
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const canContinue = Boolean(orderType && laundryType);

  const handleContinue = async () => {
    if (isSaving) return;
    if (!orderType) {
      setError('Please select an order type.');
      return;
    }
    if (!laundryType) {
      setError('Please select a laundry type.');
      return;
    }
    try {
      setError('');
      setIsSaving(true);
      // Persist onto the cart so the next step and the order both carry it.
      await saveSelections();
      navigation.navigate('BusinessCategoriesScreen');
    } catch (err: any) {
      setError(err?.message || 'Failed to save your selection');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader
        title="Order Type"
        action={
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => navigation.navigate('BusinessProfile')}
            activeOpacity={0.8}
            accessibilityLabel="Profile"
          >
            <Ionicons name="person-circle-outline" size={26} color={COLORS.Primary} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHint}>Select one order type</Text>

        {ORDER_TYPES.map((option) => {
          const isSelected = orderType === option.value;
          return (
            <View
              key={option.value}
              style={[styles.typeCard, isSelected && styles.typeCardSelected]}
            >
              <View style={styles.typeCardHeader}>
                <View style={[styles.iconCircle, isSelected && styles.iconCircleSelected]}>
                  <Ionicons
                    name={option.icon}
                    size={26}
                    color={isSelected ? COLORS.Surface : COLORS.Primary}
                  />
                </View>
                <Text style={[styles.typeTitle, isSelected && styles.typeTitleSelected]}>
                  {option.label}
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={24} color={COLORS.Primary} />
                ) : null}
              </View>

              {option.details.map((detail) => (
                <View key={detail} style={styles.detailRow}>
                  <Ionicons name="ellipse" size={5} color={COLORS.TextSecondary} />
                  <Text style={styles.detailText}>{detail}</Text>
                </View>
              ))}

              <TouchableOpacity
                style={[styles.selectButton, isSelected && styles.selectButtonSelected]}
                onPress={() => {
                  setOrderType(option.value);
                  setError('');
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={isSelected ? { selected: true } : {}}
              >
                <Text
                  style={[styles.selectButtonText, isSelected && styles.selectButtonTextSelected]}
                >
                  {isSelected ? 'Selected' : 'Select'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Select Laundry Type</Text>

        <View style={styles.laundryCard}>
          {LAUNDRY_TYPES.map((option, index) => {
            const isSelected = laundryType === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.radioRow, index === 0 && styles.radioRowDivider]}
                onPress={() => {
                  setLaundryType(option.value);
                  setError('');
                }}
                activeOpacity={0.75}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                  {isSelected ? <View style={styles.radioInner} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.radioLabel, isSelected && styles.radioLabelSelected]}>
                    {option.label}
                  </Text>
                  <Text style={styles.radioHint}>{option.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <TouchableOpacity
        style={[styles.continueButton, (!canContinue || isSaving) && styles.continueButtonDisabled]}
        onPress={handleContinue}
        disabled={!canContinue || isSaving}
        activeOpacity={0.85}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color={COLORS.Surface} />
        ) : (
          <Text style={styles.continueButtonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.Surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.light,
  },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.lg },
  sectionHint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.sm,
  },
  typeCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.Border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  typeCardSelected: { borderColor: COLORS.Primary, backgroundColor: COLORS.Accent + '18' },
  typeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleSelected: { backgroundColor: COLORS.Primary },
  typeTitle: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  typeTitleSelected: { color: COLORS.PrimaryDark },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 3 },
  detailText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  selectButton: {
    marginTop: SPACING.md,
    height: 44,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectButtonSelected: { backgroundColor: COLORS.Primary },
  selectButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.Primary,
  },
  selectButtonTextSelected: { color: COLORS.Surface },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  laundryCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    ...SHADOWS.light,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  radioRowDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.Border },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.Border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: COLORS.Primary },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.Primary },
  radioLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  radioLabelSelected: { color: COLORS.PrimaryDark },
  radioHint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  errorText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
  },
  continueButton: {
    height: 55,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.medium,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  continueButtonDisabled: { opacity: 0.5 },
  continueButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
});

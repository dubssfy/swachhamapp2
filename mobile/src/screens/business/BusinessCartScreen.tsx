import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import {
  useBusinessOrderStore,
  SERVICE_OPTIONS,
  DEFAULT_ORDER_TYPE,
  QUICK_ORDER_MULTIPLIER_FALLBACK,
  LAUNDRY_TYPE_REQUIRED_MESSAGE,
  CART_ITEM_SERVICE_REQUIRED_MESSAGE,
  CART_EMPTY_MESSAGE,
} from '../../store/businessOrderStore';
import businessOrderApi from '../../services/businessOrderApi';

/**
 * Cart / Order Confirmation.
 *
 * The Laundry Type and Quick Order selections are made earlier in the flow
 * (Home page and Order Type page) and travel here on the cart, so this screen
 * shows the cart lines and the Continue action only. The service belongs to
 * each line, chosen on the Items page, and is displayed (and switchable) per
 * item here.
 *
 * A Quick Order surcharge, when one was chosen, is still restated in the
 * banner pinned above Continue; the multiplier comes from the same server that
 * prices the order.
 */
export default function BusinessCartScreen({ navigation }: any) {
  const {
    cart,
    isLoading,
    laundryType,
    orderType,
    saveOrderType,
    loadCart,
    updateItem,
    setItemService,
    removeItem,
  } = useBusinessOrderStore();
  const [error, setError] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);
  /**
   * What Quick Order costs, from the server that prices the order. Falls back
   * to the shared constant only until that call answers.
   */
  const [quickMultiplier, setQuickMultiplier] = useState(QUICK_ORDER_MULTIPLIER_FALLBACK);

  const items = cart?.items || [];
  /** Blocks Continue until every line carries its own service. */
  const hasItemWithoutService = items.some((item) => !item.service_type);

  const refresh = useCallback(() => {
    loadCart()
      .catch((err: any) => setError(err?.message || 'Failed to load cart'))
      .finally(() => setInitialLoad(false));
  }, [loadCart]);

  // Reloading on focus is what makes Repeat Order land on a populated cart.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', refresh);
    refresh();
    return unsubscribe;
  }, [navigation, refresh]);

  // The surcharge is read from the same server that applies it.
  useEffect(() => {
    businessOrderApi
      .getLaundryServices()
      .then((response) => {
        const value = response.data.quickOrderMultiplier;
        if (typeof value === 'number' && value > 1) setQuickMultiplier(value);
      })
      .catch(() => {
        // The fallback already holds the right number; a failed lookup must
        // not stop the Cart from working.
      });
  }, []);

  /**
   * STANDARD BY DEFAULT.
   *
   * A cart with no order type is a standard order, and saying so here is what
   * lets the screen stop asking. Run once the cart has loaded, and only when
   * the field is genuinely empty, so it never overwrites a Quick Order the
   * user chose earlier in the session.
   */
  useEffect(() => {
    if (initialLoad || !cart || orderType) return;
    saveOrderType(DEFAULT_ORDER_TYPE).catch(() => {
      // Left for Continue to report: the server validates the order type as
      // well, so a silent failure here cannot produce an untyped order.
    });
  }, [initialLoad, cart, orderType, saveOrderType]);

  const isQuickOrder = orderType === 'quick';

  // No location code on this screen, and none on the Time Slot page either:
  // the service area was settled on the Allow Permission page when the app
  // opened, and ordering neither asks for a fix nor re-tests the district.

  const handleUpdateQuantity = async (itemId: string, quantity: number) => {
    if (quantity < 1) return;
    try {
      setError('');
      await updateItem(itemId, quantity);
    } catch (err: any) {
      setError(err?.message || 'Failed to update quantity');
    }
  };

  /** Each line keeps its own service, independent of the other lines. */
  const handleItemService = async (itemId: string, value: string) => {
    try {
      setError('');
      await setItemService(itemId, value);
    } catch (err: any) {
      setError(err?.message || 'Failed to change item service');
    }
  };

  const handleRemove = async (itemId: string) => {
    try {
      setError('');
      await removeItem(itemId);
    } catch (err: any) {
      setError(err?.message || 'Failed to remove item');
    }
  };

  /**
   * Cart -> Time Slot.
   *
   * The cart validates what belongs to the cart and nothing more; the day and
   * the two slots are chosen on the next page, which is also where the order
   * is finally placed. Navigating there leaves this screen mounted, so the
   * items and quantities are exactly as they were on the way back.
   */
  const handleContinue = () => {
    if (items.length === 0) {
      setError(CART_EMPTY_MESSAGE);
      return;
    }
    if (items.some((item) => !item.service_type)) {
      setError(CART_ITEM_SERVICE_REQUIRED_MESSAGE);
      return;
    }
    if (!laundryType) {
      setError(LAUNDRY_TYPE_REQUIRED_MESSAGE);
      return;
    }

    setError('');
    navigation.navigate('BusinessTimeSlotScreen');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Back on the top-left, level with the HOME button the header already
          places on the top-right. */}
      <BusinessHeader
        title="My Cart"
        onBack={() => navigation.goBack()}
      />

      {initialLoad ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              items.length > 0 ? <Text style={styles.itemsHeading}>Cart Items</Text> : null
            }
            ListEmptyComponent={
              <View style={styles.emptyBlock}>
                <Ionicons name="cart-outline" size={48} color={COLORS.TextSecondary} />
                <Text style={styles.emptyText}>Your cart is empty</Text>
                <TouchableOpacity
                  style={styles.browseButton}
                  onPress={() => navigation.navigate('BusinessHome')}
                >
                  <Text style={styles.browseButtonText}>Browse Items</Text>
                </TouchableOpacity>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.itemCard}>
                <View style={styles.itemImagePlaceholder}>
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={styles.itemImageInner}
                      resizeMode="contain"
                    />
                  ) : (
                    <Ionicons name="shirt-outline" size={24} color={COLORS.Primary} />
                  )}
                </View>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.item_name}</Text>
                  {/* Category and unit only. The business orders by the
                      piece, so a weight here is a figure it cannot act on. */}
                  <Text style={styles.itemMeta}>
                    {item.category_name} · {item.unit}
                  </Text>

                  {/* This line's own service — the only place a service is
                      shown in the Cart. Only the services the item supports
                      are offered, so a switch can never be invalid, and
                      changing one line never touches another. */}
                  <Text style={styles.itemServiceLabel}>
                    Service:{' '}
                    <Text style={styles.itemServiceValue}>
                      {item.service_type
                        ? SERVICE_OPTIONS.find((o) => o.value === item.service_type)?.label ||
                          item.service_name ||
                          item.service_type
                        : 'Not selected'}
                    </Text>
                  </Text>
                  {/* SWITCHABLE ONLY WHERE THERE IS A SWITCH TO MAKE. An item
                      the catalogue offers one service for shows the service on
                      the line above and no chips: a single chip that is always
                      selected is a button that does nothing. */}
                  <View style={styles.itemServiceRow}>
                    {(item.available_service_types.length > 1
                      ? item.available_service_types
                      : []
                    ).map((code) => {
                      const isSelected = item.service_type === code;
                      const label = SERVICE_OPTIONS.find((o) => o.value === code)?.label || code;
                      return (
                        <TouchableOpacity
                          key={code}
                          style={[styles.itemServiceChip, isSelected && styles.itemServiceChipSelected]}
                          onPress={() => handleItemService(item.item_id, code)}
                          disabled={isLoading || isSelected}
                          activeOpacity={0.8}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSelected }}
                        >
                          <Text
                            style={[
                              styles.itemServiceChipText,
                              isSelected && styles.itemServiceChipTextSelected,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {!item.service_type ? (
                    <Text style={styles.itemServiceMissing}>
                      Select a laundry service for this item.
                    </Text>
                  ) : null}

                  <View style={styles.itemActions}>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={styles.stepperButton}
                        onPress={() => handleUpdateQuantity(item.item_id, item.quantity - 1)}
                        disabled={isLoading}
                      >
                        <Ionicons name="remove" size={16} color={COLORS.Primary} />
                      </TouchableOpacity>
                      <Text style={styles.stepperValue}>{item.quantity}</Text>
                      <TouchableOpacity
                        style={styles.stepperButton}
                        onPress={() => handleUpdateQuantity(item.item_id, item.quantity + 1)}
                        disabled={isLoading}
                      >
                        <Ionicons name="add" size={16} color={COLORS.Primary} />
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity onPress={() => handleRemove(item.item_id)} disabled={isLoading}>
                      <Ionicons name="trash-outline" size={20} color={COLORS.Error} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          />

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Order summary and Confirm belong to a cart that has items. */}
          {items.length > 0 ? (
            <>
              {/* A count of lines, and nothing about weight — the Business
                  flow bills by the piece and never surfaced amounts here. */}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Items</Text>
                <Text style={styles.summaryValue}>{items.length}</Text>
              </View>

              {/* The last word before Continue. A Quick Order cannot be
                  confirmed without this line being on screen. */}
              {isQuickOrder ? (
                <View style={styles.quickBanner}>
                  <Ionicons name="flash" size={18} color={COLORS.Surface} />
                  <Text style={styles.quickBannerText}>
                    QUICK ORDER · billed at {quickMultiplier}x your standard rate
                  </Text>
                </View>
              ) : null}

              {/* Continue, not Confirm: the order is placed on the Time
                  Slot page once the day and both slots are chosen. */}
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  (!laundryType || hasItemWithoutService) && styles.confirmButtonDisabled,
                ]}
                onPress={handleContinue}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmButtonText}>Continue</Text>
                <Ionicons name="arrow-forward" size={20} color={COLORS.Surface} />
              </TouchableOpacity>
            </>
          ) : null}
        </>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  browseButton: {
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  browseButtonText: { color: COLORS.Surface, fontFamily: TYPOGRAPHY.fontFamily, fontWeight: '600' },
  // Shown when the cart has no items.
  emptyBlock: { alignItems: 'center', paddingVertical: SPACING.xl },
  itemsHeading: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  summaryLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  summaryValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  summaryValueMissing: { color: COLORS.Error },

  flex: { flex: 1 },

  /* ================= Quick Order =================
   *
   * A card with a coloured header, a two-column rate comparison and a notice
   * line. It changes appearance as a whole when switched on — not just the
   * switch — so the order's cost basis is legible from across the screen.
   */
  quickCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.Border,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    ...SHADOWS.light,
  },
  quickCardOn: { borderColor: COLORS.Warning, borderWidth: 2, ...SHADOWS.medium },

  quickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.PrimaryDark,
  },
  quickHeaderOn: { backgroundColor: COLORS.Warning },

  quickBolt: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  quickBoltOn: { backgroundColor: COLORS.Surface },

  quickTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
  },
  quickTitleOn: { color: COLORS.Surface },
  quickSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: 'rgba(255,255,255,0.85)',
  },
  quickSubtitleOn: { color: 'rgba(255,255,255,0.95)' },

  /** The multiplier, as a badge — the number that changes the bill. */
  quickBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 46,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  quickBadgeOn: { backgroundColor: COLORS.Surface },
  quickBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '900',
    color: COLORS.Surface,
    lineHeight: 20,
  },
  quickBadgeTextOn: { color: COLORS.Warning },
  quickBadgeCaption: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.85)',
  },

  /* The two rates side by side. Standard is shown to be compared against,
     not to be picked — it is the default the order already has. */
  quickCompare: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  quickOption: {
    flex: 1,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.Border,
    backgroundColor: COLORS.Background,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    gap: 2,
  },
  quickOptionActive: { borderColor: COLORS.Primary, backgroundColor: '#EAF6EF' },
  quickOptionActiveQuick: { borderColor: COLORS.Warning, backgroundColor: '#FFF6E8' },
  quickOptionHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quickOptionName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.TextSecondary,
  },
  quickOptionNameActive: { color: COLORS.PrimaryDark },
  quickOptionNameQuick: { color: '#9A5200' },
  quickOptionRate: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  quickOptionRateActive: { color: COLORS.PrimaryDark, fontWeight: '700' },
  quickOptionRateQuick: { color: '#9A5200', fontWeight: '800' },

  quickNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    margin: SPACING.md,
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.Background,
  },
  quickNoticeOn: { backgroundColor: '#FDECEC' },
  quickNoticeText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  quickNoticeTextOn: { color: COLORS.Error, fontWeight: '700' },

  /** Restated directly above Continue, where it cannot be scrolled past. */
  quickBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.Error,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  quickBannerText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.Surface,
  },

  errorText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
  },
  listContent: { padding: SPACING.md },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  itemImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    overflow: 'hidden',
  },
  itemImageInner: { width: '100%', height: '100%' },
  itemInfo: { flex: 1 },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  itemMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
    marginBottom: SPACING.sm,
  },
  // Per-line service, in the same surface/border/primary language as the
  // Order Type and Laundry Type options below the list.
  itemServiceLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginBottom: 4,
  },
  itemServiceValue: { fontWeight: '700', color: COLORS.PrimaryDark },
  itemServiceMissing: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Error,
    marginBottom: SPACING.sm,
  },
  itemServiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.sm },
  itemServiceChip: {
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
  },
  itemServiceChipSelected: { borderColor: COLORS.Primary, backgroundColor: COLORS.Accent + '25' },
  itemServiceChipText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    color: COLORS.TextSecondary,
  },
  itemServiceChipTextSelected: { color: COLORS.PrimaryDark, fontWeight: '700' },
  itemActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.sm,
  },
  stepperButton: { padding: SPACING.xs, width: 30, alignItems: 'center' },
  stepperValue: {
    width: 28,
    textAlign: 'center',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },

  // ---- Order Type + Laundry Type, the two compulsory Cart selections ----
  serviceCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  serviceTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  required: { color: COLORS.Error },
  serviceHint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.sm,
  },
  serviceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  serviceOptionSelected: { borderColor: COLORS.Primary, backgroundColor: COLORS.Accent + '18' },
  serviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.Background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIconSelected: { backgroundColor: COLORS.Primary },
  serviceLabel: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },
  // Used when the label sits above a hint inside its own column, where the
  // row-level flex would otherwise stretch it.
  serviceLabelStacked: { flex: 0 },
  serviceLabelSelected: { color: COLORS.PrimaryDark },
  serviceOptionHint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.Border,
  },

  confirmButton: {
    height: 55,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.medium,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  confirmButtonDisabled: { opacity: 0.6 },
  confirmButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
});

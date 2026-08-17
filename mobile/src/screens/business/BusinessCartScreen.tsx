import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import BusinessHeader from '../../components/business/BusinessHeader';
import {
  useBusinessOrderStore,
  SERVICE_OPTIONS,
  SERVICE_REQUIRED_MESSAGE,
  ORDER_TYPE_OPTIONS,
  ORDER_TYPE_REQUIRED_MESSAGE,
  ServiceType,
  OrderType,
} from '../../store/businessOrderStore';
import { formatWeightKg } from '../../utils/businessOrderPdf';

const SERVICE_ICONS: Record<ServiceType, keyof typeof Ionicons.glyphMap> = {
  wash_iron: 'water-outline',
  dry_clean: 'sparkles-outline',
};

const ORDER_TYPE_ICONS: Record<OrderType, keyof typeof Ionicons.glyphMap> = {
  standard: 'time-outline',
  quick: 'flash-outline',
};

export default function BusinessCartScreen({ navigation }: any) {
  const {
    cart,
    isLoading,
    serviceType,
    orderType,
    saveOrderType,
    loadCart,
    updateItem,
    setItemService,
    removeItem,
    setServiceType,
    confirmOrder,
  } = useBusinessOrderStore();
  const [error, setError] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

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

  /** Order type is stored on the cart and travels onto the order from there. */
  const handleSelectOrderType = async (value: OrderType) => {
    try {
      setError('');
      await saveOrderType(value);
    } catch (err: any) {
      setError(err?.message || 'Failed to select order type');
    }
  };

  const handleSelectService = async (value: ServiceType) => {
    try {
      setError('');
      await setServiceType(value);
    } catch (err: any) {
      setError(err?.message || 'Failed to select service');
    }
  };

  const handleConfirmOrder = async () => {
    if (isConfirming) return;

    // Order type and service are both mandatory before booking. The backend
    // enforces both too.
    if (!orderType) {
      setError(ORDER_TYPE_REQUIRED_MESSAGE);
      return;
    }
    if (!serviceType) {
      setError(SERVICE_REQUIRED_MESSAGE);
      return;
    }

    try {
      setIsConfirming(true);
      setError('');
      const order = await confirmOrder();
      Alert.alert('Order Placed', `Your order ${order.order_number} has been placed successfully.`, [
        {
          text: 'OK',
          onPress: () => navigation.navigate('BusinessOrders'),
        },
      ]);
    } catch (err: any) {
      setError(err?.message || 'Failed to place order');
    } finally {
      setIsConfirming(false);
    }
  };

  const items = cart?.items || [];

  // Same card/radio pattern as the service section below it.
  const orderTypeSection = (
    <View style={styles.serviceCard}>
      <Text style={styles.serviceTitle}>Order Type</Text>
      <Text style={styles.serviceHint}>Select one order type for this order</Text>

      {ORDER_TYPE_OPTIONS.map((option) => {
        const isSelected = orderType === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.serviceOption, isSelected && styles.serviceOptionSelected]}
            onPress={() => handleSelectOrderType(option.value)}
            disabled={isLoading}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <View style={[styles.serviceIcon, isSelected && styles.serviceIconSelected]}>
              <Ionicons
                name={ORDER_TYPE_ICONS[option.value]}
                size={20}
                color={isSelected ? COLORS.Surface : COLORS.Primary}
              />
            </View>
            <Text style={[styles.serviceLabel, isSelected && styles.serviceLabelSelected]}>
              {option.label}
            </Text>
            {isSelected ? (
              <Ionicons name="checkmark-circle" size={22} color={COLORS.Primary} />
            ) : (
              <View style={styles.radioOuter} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const serviceSection = (
    <View style={styles.serviceCard}>
      <Text style={styles.serviceTitle}>Service</Text>
      <Text style={styles.serviceHint}>Select one service for this order</Text>

      {SERVICE_OPTIONS.map((option) => {
        const isSelected = serviceType === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.serviceOption, isSelected && styles.serviceOptionSelected]}
            onPress={() => handleSelectService(option.value)}
            disabled={isLoading}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <View style={[styles.serviceIcon, isSelected && styles.serviceIconSelected]}>
              <Ionicons
                name={SERVICE_ICONS[option.value]}
                size={20}
                color={isSelected ? COLORS.Surface : COLORS.Primary}
              />
            </View>
            <Text style={[styles.serviceLabel, isSelected && styles.serviceLabelSelected]}>
              {option.label}
            </Text>
            {isSelected ? (
              <Ionicons name="checkmark-circle" size={22} color={COLORS.Primary} />
            ) : (
              <View style={styles.radioOuter} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BusinessHeader title="My Cart" />

      {cart && (cart.laundry_type || cart.order_type) ? (
        <View style={styles.contextRow}>
          {cart.laundry_type ? (
            <View style={styles.contextTag}>
              <Text style={styles.contextText}>
                {cart.laundry_type === 'hotel' ? 'Hotel Laundry' : 'Guest Laundry'}
              </Text>
            </View>
          ) : null}
          {cart.order_type ? (
            <View style={styles.contextTag}>
              <Text style={styles.contextText}>
                {cart.order_type === 'quick' ? 'Quick Order' : 'Standard Order'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {initialLoad ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="cart-outline" size={48} color={COLORS.TextSecondary} />
          <Text style={styles.emptyText}>Your cart is empty</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity style={styles.browseButton} onPress={() => navigation.navigate('BusinessHome')}>
            <Text style={styles.browseButtonText}>Browse Items</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              <>
                {orderTypeSection}
                {serviceSection}
              </>
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
                  {/* Unit weight comes from the catalogue; the line total is
                      that weight multiplied by the quantity. */}
                  <Text style={styles.itemMeta}>
                    {item.category_name} · {item.unit} · {formatWeightKg(item.weight_kg)} ×{' '}
                    {item.quantity} = {formatWeightKg(item.total_weight_kg)}
                  </Text>

                  {/* This line's service. Only the services the item supports
                      are offered, so a switch can never be invalid. */}
                  <View style={styles.itemServiceRow}>
                    {(item.available_service_types.length > 0
                      ? item.available_service_types
                      : item.service_type
                      ? [item.service_type]
                      : []
                    ).map((code) => {
                      const isSelected = item.service_type === code;
                      const label = SERVICE_OPTIONS.find((o) => o.value === code)?.label || code;
                      const onlyOne = item.available_service_types.length <= 1;
                      return (
                        <TouchableOpacity
                          key={code}
                          style={[styles.itemServiceChip, isSelected && styles.itemServiceChipSelected]}
                          onPress={() => handleItemService(item.item_id, code)}
                          disabled={isLoading || onlyOne}
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

          {/* Weight, not price — the Business flow never surfaces amounts. */}
          <View style={styles.weightRow}>
            <Text style={styles.weightLabel}>Total Weight</Text>
            <Text style={styles.weightValue}>{formatWeightKg(cart?.total_weight_kg)}</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.confirmButton,
              (isConfirming || !orderType || !serviceType) && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirmOrder}
            disabled={isConfirming}
            activeOpacity={0.8}
          >
            {isConfirming ? (
              <ActivityIndicator size="small" color={COLORS.Surface} />
            ) : (
              <Text style={styles.confirmButtonText}>Confirm Order</Text>
            )}
          </TouchableOpacity>
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
  },
  weightLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  weightValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.Primary,
  },
  errorText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
  },
  contextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  contextTag: {
    backgroundColor: COLORS.Accent + '35',
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
  },
  contextText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.PrimaryDark,
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
  // cart's own service options below the list.
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

  // ---- Service selection (moved here from its own pre-catalogue page) ----
  serviceCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.xs,
    ...SHADOWS.light,
  },
  serviceTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
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
  serviceLabelSelected: { color: COLORS.PrimaryDark },
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

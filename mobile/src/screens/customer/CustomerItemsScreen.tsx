import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  RefreshControl, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import customerCartApi, {
  customerCatalogueApi, CustomerItem, ItemServiceOption,
} from '../../services/customerCartApi';
import CartIconButton from './CartIconButton';
import { useCartFly } from '../../components/CartFlyOverlay';

/**
 * The items in one category, and the sheet that adds one to the cart.
 *
 * ITEM -> SERVICE -> QUANTITY -> PRICE -> ADD TO CART, which is the flow the
 * customer was promised. The service matters because it changes the price:
 * Wash and Fold and Dry Clean are different rates for the same shirt, so the
 * choice has to come before the total can be shown.
 *
 * EVERY PRICE IS THE SERVER'S. The list shows each item's lowest rate as a
 * "from" figure — the exact price depends on a service not yet chosen — and
 * the sheet then shows the real rate per service. Neither is computed here;
 * the only arithmetic on this screen is price x quantity, shown as a preview,
 * and the cart re-reads the price when the line is added.
 *
 * AN ITEM WITH NO PRICE CANNOT BE ADDED. The button is disabled and says so,
 * matching what the server would answer anyway — better to say it before the
 * tap than after.
 */
export default function CustomerItemsScreen({ navigation, route }: any) {
  const categoryId: string = route.params?.categoryId;
  const categoryName: string = route.params?.categoryName ?? 'Items';

  const [items, setItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<CustomerItem | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setItems(await customerCatalogueApi.getItems(categoryId));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load items');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{categoryName}</Text>
        <CartIconButton navigation={navigation} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {items.length === 0 && !error ? (
            <View style={styles.empty}>
              <Ionicons name="shirt-outline" size={40} color={COLORS.TextSecondary} />
              <Text style={styles.emptyTitle}>No items in {categoryName} yet</Text>
              <Text style={styles.emptyText}>
                Items for this category have not been added yet.
              </Text>
            </View>
          ) : (
            items.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                onPress={() => setChosen(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, choose service and quantity`}
                activeOpacity={0.9}
              >
                <View style={styles.iconBox}>
                  <Ionicons
                    name="shirt-outline"
                    size={20}
                    color="#7A4A00"
                  />
                </View>

                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>
                    {item.name}
                  </Text>

                  {/* "From", because the exact rate depends on the service. */}
                  <Text style={styles.cardMeta}>
                    {item.price === null || Number(item.price) === 0
                      ? 'Price not set'
                      : `from ₹${Number(item.price).toFixed(2)} per ${
                          item.unit || 'piece'
                        }`}
                  </Text>
                </View>

                <View style={styles.addPill}>
                  <Ionicons
                    name="add"
                    size={16}
                    color="#FFFFFF"
                  />
                  <Text style={styles.addPillText}>
                    Add
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      )}

      <AddToCartSheet
        item={chosen}
        onClose={() => setChosen(null)}
        onAdded={() => setChosen(null)}
      />
    </SafeAreaView>
  );
}

/**
 * Choose the service, choose the quantity, see the total, add it.
 *
 * The services and their prices are fetched PER ITEM, because the price list
 * holds a rate per (item, service) and the list endpoint can only carry one
 * figure per item.
 */
function AddToCartSheet({
  item, onClose, onAdded,
}: {
  item: CustomerItem | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [options, setOptions] = useState<ItemServiceOption[]>([]);
  const [serviceId, setServiceId] = useState<string>('');
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item) return;
    setError('');
    setQuantity('1');
    setServiceId('');
    setLoading(true);
    customerCatalogueApi
      .getItemServiceOptions(item.id)
      .then((rows) => {
        setOptions(rows);
        /*
         * An item offered for ONE service needs no choice, so it is
         * pre-selected — a single-option radio asks a question with one
         * answer. With two, the customer picks.
         */
        if (rows.length === 1) setServiceId(rows[0].service_id);
      })
      .catch((e: any) =>
        setError(e?.response?.data?.message || e.message || 'Could not load services'))
      .finally(() => setLoading(false));
  }, [item]);

  /** The button the bag flies FROM, and the overlay it flies in. */
  const addBtnRef = useRef<View>(null);
  const { flyToCart } = useCartFly();

  const selected = options.find((o) => o.service_id === serviceId) || null;
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  const unitPrice = selected?.price ?? null;
  const lineTotal = unitPrice === null ? null : Math.round(unitPrice * qty * 100) / 100;

  const problem =
    !serviceId ? 'Choose a service.'
      : unitPrice === null ? 'This service has no price set yet, so it cannot be added.'
        : Number(quantity) < 1 ? 'Enter a quantity of at least 1.'
          : '';

  const add = async () => {
    if (!item || problem || saving) return;
    setSaving(true);
    setError('');
    /*
     * WHERE THE BAG STARTS — measured NOW, while the button is still on
     * screen. `onAdded` closes this sheet, so measuring afterwards would
     * measure a view that is being torn down.
     */
    let from: { x: number; y: number } | null = null;
    await new Promise<void>((resolve) => {
      if (!addBtnRef.current) return resolve();
      addBtnRef.current.measureInWindow((x, y, width, height) => {
        if (typeof x === 'number' && typeof y === 'number') {
          from = { x: x + width / 2, y: y + height / 2 };
        }
        resolve();
      });
    });
    try {
      await customerCartApi.addItem(item.id, qty, serviceId);
      onAdded();
      /*
       * ONLY ONCE THE SERVER HAS IT. The bag says "this is in your cart", so
       * animating before the call returned would say it of an item that might
       * still fail to be added.
       */
      if (from) flyToCart(from);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not add this item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={item !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{item?.name}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {loading ? (
              <ActivityIndicator color={COLORS.Primary} style={{ marginVertical: SPACING.lg }} />
            ) : (
              <>
                <Text style={styles.label}>SELECT SERVICE</Text>
                {options.length === 0 ? (
                  <Text style={styles.muted}>
                    No services are configured for this item yet.
                  </Text>
                ) : (
                  options.map((option) => {
                    const on = option.service_id === serviceId;
                    const unpriced = option.price === null;
                    return (
                      <TouchableOpacity
                        key={option.service_id}
                        style={[styles.option, on && styles.optionOn, unpriced && styles.optionOff]}
                        onPress={() => !unpriced && setServiceId(option.service_id)}
                        disabled={unpriced}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on, disabled: unpriced }}
                      >
                        <Ionicons
                          name={on ? 'radio-button-on' : 'radio-button-off'}
                          size={18}
                          color={on ? COLORS.Primary : COLORS.TextSecondary}
                        />
                        <Text style={[styles.optionName, on && styles.optionNameOn]}>
                          {option.name}
                        </Text>
                        <Text style={[styles.optionPrice, unpriced && styles.optionPriceOff]}>
                          {unpriced
                            ? 'Price not set'
                            : `₹${Number(option.price).toFixed(2)}/${item?.unit || 'piece'}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}

                <Text style={[styles.label, { marginTop: SPACING.md }]}>QUANTITY</Text>
                <View style={styles.qtyRow}>
                  <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => setQuantity(String(Math.max(1, qty - 1)))}
                    accessibilityLabel="Reduce quantity"
                  >
                    <Ionicons name="remove" size={18} color={COLORS.TextPrimary} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.qtyInput}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="number-pad"
                    accessibilityLabel="Quantity"
                  />
                  <TouchableOpacity
                    style={[styles.qtyBtn, styles.qtyBtnAdd]}
                    onPress={() => setQuantity(String(qty + 1))}
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add" size={18} color={COLORS.Surface} />
                  </TouchableOpacity>
                </View>

                {/* The arithmetic, spelled out: rate x quantity = total. */}
                <View style={styles.mathBox}>
                  {unitPrice === null ? (
                    <Text style={styles.mathMuted}>Choose a priced service to see the total.</Text>
                  ) : (
                    <Text style={styles.math}>
                      ₹{unitPrice.toFixed(2)} × {qty} ={' '}
                      <Text style={styles.mathTotal}>₹{lineTotal!.toFixed(2)}</Text>
                    </Text>
                  )}
                </View>

                {!!problem && <Text style={styles.problem}>{problem}</Text>}

                <TouchableOpacity
                  ref={addBtnRef}
                  style={[styles.addBtn, (!!problem || saving) && styles.addBtnDisabled]}
                  onPress={add}
                  disabled={!!problem || saving}
                  accessibilityLabel="Add to cart"
                >
                  {saving ? (
                    <ActivityIndicator color={COLORS.Surface} />
                  ) : (
                    <Text style={styles.addBtnText}>ADD TO CART</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
            <View style={{ height: SPACING.lg }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background ?? '#F4F7F5' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.Border,
  },
  back: { padding: 4 },
  title: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '700', color: COLORS.TextPrimary,
  },
  scroll: { padding: SPACING.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,

    // Main #ffbd4a theme.
    backgroundColor: '#FFF3D1',

    borderRadius: BORDER_RADIUS.md,

    borderWidth: 1.5,
    borderColor: '#F4C76A',

    padding: SPACING.sm,
    marginBottom: SPACING.sm,

    shadowColor: '#8A5A00',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 3,
  },

  iconBox: {
    width: 40,
    height: 40,
    borderRadius: BORDER_RADIUS.md,

    // Light shade of #ffbd4a.
    backgroundColor: '#FFF9E8',

    alignItems: 'center',
    justifyContent: 'center',

    borderWidth: 1,
    borderColor: '#F4C76A',
  },

  cardBody: {
    flex: 1,
  },

  cardTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: '#5A3A08',
  },

  cardMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: '#80601F',
    marginTop: 2,
  },

  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,

    // Dark shade for contrast.
    backgroundColor: '#E5A83D',

    borderRadius: BORDER_RADIUS.sm ?? 8,

    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  addPillText: {
    color: '#FFFFFF',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '800',
  },
  empty: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.xs },
  emptyTitle: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary, textAlign: 'center', paddingHorizontal: SPACING.xl,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.Surface,
    borderTopLeftRadius: BORDER_RADIUS.lg ?? 16,
    borderTopRightRadius: BORDER_RADIUS.lg ?? 16,
    maxHeight: '85%',
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.Border,
  },
  sheetTitle: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '700', color: COLORS.TextPrimary,
  },
  sheetBody: { padding: SPACING.md },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: 10, letterSpacing: 0.6,
    fontWeight: '700', color: COLORS.TextSecondary, marginBottom: SPACING.xs,
  },
  muted: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.Border, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.xs,
  },
  optionOn: { borderColor: COLORS.Primary, backgroundColor: COLORS.Accent },
  optionOff: { opacity: 0.5 },
  optionName: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextPrimary,
  },
  optionNameOn: { fontWeight: '700' },
  optionPrice: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  optionPriceOff: { color: COLORS.Warning, fontWeight: '600', fontSize: TYPOGRAPHY.sizes.xs },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  qtyBtn: {
    width: 38, height: 38, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.Border,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnAdd: { backgroundColor: COLORS.Primary, borderColor: COLORS.Primary },
  qtyInput: {
    width: 70, height: 38, textAlign: 'center',
    borderWidth: 1, borderColor: COLORS.Border, borderRadius: BORDER_RADIUS.md,
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700', color: COLORS.TextPrimary,
  },
  mathBox: {
    backgroundColor: COLORS.Accent, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginTop: SPACING.md,
  },
  math: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },
  mathTotal: { fontWeight: '700', fontSize: TYPOGRAPHY.sizes.lg },
  mathMuted: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  problem: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Warning, marginTop: SPACING.xs,
  },
  addBtn: {
    backgroundColor: COLORS.Primary, borderRadius: BORDER_RADIUS.md,
    paddingVertical: 14, alignItems: 'center', marginTop: SPACING.md,
  },
  addBtnDisabled: { opacity: 0.45 },
  addBtnText: {
    color: COLORS.Surface, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base, fontWeight: '700', letterSpacing: 0.5,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: '#FDECEC', borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  errorText: {
    flex: 1, fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs, color: COLORS.Error,
  },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import sorterApi, {
  SorterOrderDetail,
  SorterStage,
  ScanStatus,
  ScanStageName,
} from '../../services/sorterApi';
import { extractErrorMessage } from '../../services/api';
import { BusinessOrderDetail } from '../../services/businessOrderApi';
import {
  generateOrderPdf,
  formatWeightKg,
  formatDateTime,
  LAUNDRY_LABEL,
  ORDER_LABEL,
} from '../../utils/businessOrderPdf';
import { STAGE_META } from './SorterDashboardScreen';

/**
 * The one step available from each stage, the label it carries, and which
 * scan session must be complete first. A step with no `scan` needs none.
 */
const NEXT_ACTION: Record<
  SorterStage,
  { target: 'accepted' | 'ready' | 'out_for_delivery'; label: string; scan?: ScanStageName } | null
> = {
  confirmed: { target: 'accepted', label: 'ACCEPT ORDER', scan: 'acceptance' },
  accepted: { target: 'ready', label: 'MARK AS READY' },
  ready: { target: 'out_for_delivery', label: 'OUT FOR DELIVERY', scan: 'delivery' },
  out_for_delivery: null,
};

/**
 * Sorter order detail.
 *
 * Shows the job, the confirmation document and exactly one forward action.
 * The action the screen offers is derived from the current status, and the
 * server re-validates the transition, so the UI can never talk it into a skip.
 */
export default function SorterOrderDetailsScreen({ navigation, route }: any) {
  const { orderId } = route.params || {};
  const [order, setOrder] = useState<SorterOrderDetail | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isBuildingPdf, setIsBuildingPdf] = useState(false);
  const [error, setError] = useState('');
  /** Synchronous lock: two taps in one frame cannot both fire a transition. */
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setIsLoading(true);
      const [detail, scanStatus] = await Promise.all([
        sorterApi.getOrderById(String(orderId)),
        sorterApi.getScanStatus(String(orderId)),
      ]);
      setOrder(detail.data);
      setScan(scanStatus.data);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load order'));
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    load();
    return unsubscribe;
  }, [navigation, load]);

  /**
   * The confirmation document.
   *
   * A stored URL wins when the order has one. Otherwise the same PDF template
   * the Business app uses renders it from the order data — one generator, one
   * layout, and no second copy of the document anywhere.
   */
  const handleViewPdf = async () => {
    if (isBuildingPdf || !order) return;
    try {
      setIsBuildingPdf(true);
      setError('');

      const response = await sorterApi.getConfirmationPdf(String(orderId));
      if (response.data.url) {
        await Linking.openURL(response.data.url);
        return;
      }

      const { uri, fileName } = await generateOrderPdf(toPdfShape(response.data.order));
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('PDF ready', fileName);
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: fileName,
        UTI: 'com.adobe.pdf',
      });
    } catch (err: any) {
      if (__DEV__) console.error('[Sorter] PDF failed', err);
      setError('Unable to open the confirmation PDF. Please try again.');
    } finally {
      setIsBuildingPdf(false);
    }
  };

  /** Confirmed first — a status change on the shop floor is hard to walk back. */
  const handleAdvance = () => {
    if (!order || !order.stage) return;
    const action = NEXT_ACTION[order.stage];
    if (!action || busyRef.current) return;

    Alert.alert(
      action.label === 'ACCEPT ORDER' ? 'Accept order' : 'Mark as ready',
      `Order #${order.order_number}\n\nSet this order to "${action.target}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => advance(action.target) },
      ]
    );
  };

  const advance = async (target: 'accepted' | 'ready' | 'out_for_delivery') => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      setIsUpdating(true);
      setError('');
      const response = await sorterApi.updateStatus(String(orderId), target);
      Alert.alert('Status updated', `Order #${response.data.order_number} is now ${target}.`);
      await load();
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to update status'));
    } finally {
      setIsUpdating(false);
      busyRef.current = false;
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={44} color={COLORS.Error} />
          <Text style={styles.errorText}>{error || 'Order not found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const meta = order.stage ? STAGE_META[order.stage] : null;
  const action = order.stage ? NEXT_ACTION[order.stage] : null;

  // Which scan session this stage needs, and whether it is complete.
  const scanStage = action?.scan ?? null;
  const scanScanned = scanStage === 'delivery' ? scan?.delivery_scanned ?? 0 : scan?.acceptance_scanned ?? 0;
  const scanMatched = scanStage === 'delivery' ? scan?.delivery_matched ?? false : scan?.acceptance_matched ?? false;
  const scanRemaining = Math.max((scan?.expected_count ?? 0) - scanScanned, 0);
  /** A step that needs scanning stays locked until the counts agree. */
  const actionBlocked = Boolean(scanStage) && !scanMatched;
  const { date, time } = formatDateTime(order.created_at);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headlineRow}>
          <Text style={styles.orderNumber}>#{order.order_number}</Text>
          {meta ? (
            <View style={[styles.statusPill, { backgroundColor: meta.color }]}>
              <Text style={styles.statusText}>{meta.label}</Text>
            </View>
          ) : null}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer</Text>
          <Row label="Name" value={order.customer_name} />
          <Row label="Contact" value={order.customer_contact || '—'} />
          <Row label="Order Date" value={`${date} ${time}`} />
          <Row label="Laundry Type" value={LAUNDRY_LABEL[order.laundry_type || ''] || '—'} />
          <Row label="Order Type" value={ORDER_LABEL[order.order_type || ''] || '—'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items ({order.item_count})</Text>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.itemName}>{item.item_name}</Text>
                <Text style={styles.itemMeta}>
                  Service: {item.laundry_service_name || '—'}
                </Text>
                <Text style={styles.itemMeta}>
                  {item.category_name || '—'} · {formatWeightKg(item.weight_kg)} each
                </Text>
              </View>
              <View style={styles.itemRight}>
                <Text style={styles.itemQty}>× {item.quantity}</Text>
                <Text style={styles.itemWeight}>{formatWeightKg(item.total_weight_kg)}</Text>
              </View>
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Weight</Text>
            <Text style={styles.totalValue}>{formatWeightKg(order.total_weight_kg)}</Text>
          </View>
        </View>

        {/* Garment verification. The counts come from the server, and the
            forward action stays locked until it reports a match — the server
            re-checks the same rule when the button is pressed. */}
        {scan ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Garment verification</Text>
            <Row label="Expected garments" value={String(scan.expected_count)} />
            <Row
              label="Acceptance scanned"
              value={`${scan.acceptance_scanned} / ${scan.expected_count}`}
            />
            <Row
              label="Delivery scanned"
              value={`${scan.delivery_scanned} / ${scan.expected_count}`}
            />

            {scanStage && scanMatched ? (
              <View style={styles.matchBanner}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.Surface} />
                <Text style={styles.matchText}>
                  ✓ QUANTITY MATCH — all garments{' '}
                  {scanStage === 'acceptance' ? 'scanned' : 'verified for delivery'}.
                </Text>
              </View>
            ) : null}

            {scanStage && !scanMatched ? (
              <Text style={styles.mismatchText}>
                Quantity does not match — {scanRemaining} garment
                {scanRemaining === 1 ? '' : 's'} remaining.
              </Text>
            ) : null}

            {scanStage ? (
              <TouchableOpacity
                style={styles.scanButton}
                onPress={() =>
                  navigation.navigate('SorterScanScreen', { orderId, stage: scanStage })
                }
                activeOpacity={0.85}
              >
                <Ionicons name="barcode-outline" size={22} color={COLORS.Surface} />
                <Text style={styles.scanButtonText}>
                  {scanStage === 'acceptance' ? 'SCAN GARMENTS' : 'DELIVERY VERIFICATION'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.secondaryButton, isBuildingPdf && styles.buttonDisabled]}
          onPress={handleViewPdf}
          disabled={isBuildingPdf}
          activeOpacity={0.85}
        >
          {isBuildingPdf ? (
            <ActivityIndicator size="small" color={COLORS.Primary} />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={20} color={COLORS.Primary} />
              <Text style={styles.secondaryButtonText}>VIEW CONFIRMATION PDF</Text>
            </>
          )}
        </TouchableOpacity>

        {action ? (
          <TouchableOpacity
            style={[styles.primaryButton, (isUpdating || actionBlocked) && styles.buttonDisabled]}
            onPress={handleAdvance}
            disabled={isUpdating || actionBlocked}
            activeOpacity={0.85}
          >
            {isUpdating ? (
              <ActivityIndicator size="small" color={COLORS.Surface} />
            ) : (
              <>
                <Ionicons name="arrow-forward-circle-outline" size={22} color={COLORS.Surface} />
                <Text style={styles.primaryButtonText}>{action.label}</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          // Ready is the end of the Sorter's responsibility; delivery belongs
          // to the existing pipeline, so no further action is offered here.
          <View style={styles.doneBox}>
            <Ionicons name="checkmark-circle" size={22} color={COLORS.Success} />
            <Text style={styles.doneText}>
              This order is ready. Delivery is handled by the existing workflow.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Adapts the Sorter payload to the shape the shared PDF template reads, so the
 * document the Sorter opens is the same one the Business app produces. Amounts
 * are zero here — the template then omits its pricing columns entirely.
 */
function toPdfShape(order: SorterOrderDetail): BusinessOrderDetail {
  return {
    id: order.id,
    order_number: order.order_number,
    laundry_type: order.laundry_type,
    order_type: order.order_type,
    service_type: null,
    service_name: null,
    status: order.status,
    total: 0,
    item_count: order.item_count,
    total_quantity: order.total_quantity,
    total_weight_kg: order.total_weight_kg,
    created_at: order.created_at,
    business_name: order.customer_name,
    contact_person_name: null,
    business_mobile: order.customer_contact,
    business_email: null,
    business_address: null,
    subtotal: 0,
    delivery_charge: 0,
    tax: 0,
    coupon_discount: 0,
    items: order.items.map((item) => ({
      id: item.id,
      service_id: null,
      service_name: item.item_name,
      laundry_service_name: item.laundry_service_name,
      category_id: null,
      category_name: item.category_name,
      image_url: null,
      quantity: item.quantity,
      unit: item.unit,
      weight_kg: item.weight_kg,
      total_weight_kg: item.total_weight_kg,
      unit_price: 0,
      total_price: 0,
    })),
  };
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Order Details</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, padding: SPACING.xl },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.Surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.Background,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },

  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  orderNumber: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  statusPill: { borderRadius: BORDER_RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 6 },
  statusText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },

  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.light,
  },
  cardTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.xs,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.md, paddingVertical: 5 },
  rowLabel: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextSecondary },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextPrimary,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
  },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  itemMeta: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  itemRight: { alignItems: 'flex-end' },
  itemQty: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
  },
  itemWeight: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 2,
    borderTopColor: COLORS.Border,
  },
  totalLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  totalValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.Primary,
  },

  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: 60,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    ...SHADOWS.medium,
  },
  primaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: 56,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    borderWidth: 2,
    borderColor: COLORS.Primary,
    marginBottom: SPACING.md,
  },
  secondaryButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Primary,
    letterSpacing: 0.5,
  },
  buttonDisabled: { opacity: 0.6 },

  matchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Success,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.sm,
  },
  matchText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.Surface,
  },
  mismatchText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Warning,
    marginTop: SPACING.sm,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: 56,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.PrimaryDark,
    marginTop: SPACING.md,
    ...SHADOWS.light,
  },
  scanButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '800',
    color: COLORS.Surface,
    letterSpacing: 0.5,
  },

  doneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.Accent + '30',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  doneText: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.PrimaryDark,
    fontWeight: '600',
  },

  errorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  retryButton: {
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  retryButtonText: { color: COLORS.Surface, fontFamily: TYPOGRAPHY.fontFamily, fontWeight: '600' },
});

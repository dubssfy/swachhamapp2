import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { sa, STATUS_TONE } from './styles';
import superAdminApi, {
  BusinessPrice, BusinessCompletenessRow, LaundryTypeValue,
} from '../../services/superAdminApi';
import CategoryItemPicker from './CategoryItemPicker';
import { printPriceListPdf } from './printPriceList';

/**
 * Business Price List — a separate price list per business.
 *
 * Pick a business first, because the price only means anything in the
 * context of one: the same item is ₹30 for one hotel and ₹35 for
 * another, and neither figure is "the" business price.
 *
 * The list includes items that have NO price for this business yet,
 * shown as "Not set". They are the whole reason the screen exists —
 * an unconfigured item blocks that business's orders, so it has to be
 * visible rather than absent.
 *
 * The Customer Price column is the global customer price, for reference
 * only. It is never used as a fallback: the backend refuses to price an
 * order from it.
 *
 * LAUNDRY TYPE. A business pays one rate for its own linen (Hotel Laundry)
 * and another for its guests' clothes (Guest Laundry), so the list shows
 * one type at a time and the selector switches between them. The two are
 * separate rows in the price list: editing one never moves the other.
 *
 * CATEGORY -> SUB-CATEGORY -> ITEMS, and in that order.
 *
 * The list is not shown until a main category is chosen, and — for a category
 * that has sub-categories — until a sub-category is chosen under it. A
 * business's price list runs to a hundred items; picking the sub-category
 * first is how one of them is actually found.
 *
 * The sub-category choices DEPEND on the category above them: only that
 * category's own children are offered, so an impossible pair cannot be
 * selected. The ordering comes from the backend, so the screen shows the
 * catalogue's own order and an item added to a sub-category appears exactly
 * where the backend files it.
 */

/** The two rates a business can be priced at. Fixed by the backend enum. */
export const LAUNDRY_TYPES: Array<{ value: LaundryTypeValue; label: string }> = [
  { value: 'hotel', label: 'Hotel Laundry' },
  { value: 'guest', label: 'Guest Laundry' },
];

/*
 * The BUSINESS and the LAUNDRY TYPE are fixed for the whole list -- both are
 * chosen above and every row belongs to them -- so they are stated once in the
 * caption rather than repeated on each row, where they would be forty
 * identical cells. The CATEGORY and SUB-CATEGORY are now the group headings
 * they name, for the same reason: a column that repeats the heading above it
 * is the flat list this screen used to be.
 */
type Filter = 'all' | 'set' | 'unset';

const money = (value: number | null) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toFixed(2)}`;

export default function SuperAdminBusinessPricesScreen({ navigation, route }: any) {
  const [businesses, setBusinesses] = useState<BusinessCompletenessRow[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(route?.params?.businessId ?? null);
  const [picking, setPicking] = useState(false);
  /** Which rate the table is showing. Every row below belongs to this type. */
  const [laundryType, setLaundryType] = useState<LaundryTypeValue>('hotel');
  /** Open when "+ Add New Entry" was pressed rather than a row's edit icon. */
  const [addingNew, setAddingNew] = useState(false);

  const [rows, setRows] = useState<BusinessPrice[]>([]);
  /**
   * Which of the three list buttons was last opened, so it stays highlighted
   * when the admin comes back. The list itself now lives on its own page —
   * SuperAdminBusinessPricesListScreen.
   */
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  /** True while the printable rate card is being fetched. */
  const [printing, setPrinting] = useState(false);

  const business = businesses.find((b) => b.business_id === businessId) || null;
  const laundryTypeLabel =
    LAUNDRY_TYPES.find((t) => t.value === laundryType)?.label ?? '';

  const loadBusinesses = useCallback(async () => {
    try {
      const list = await superAdminApi.listBusinesses(false);
      setBusinesses(list);
      // Opening straight into a list is more useful than an empty screen
      // when there is only one business to choose from.
      if (!businessId && list.length === 1) setBusinessId(list[0].business_id);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load businesses');
    }
  }, [businessId]);

  // Re-fetched whenever the business OR the laundry type changes: it feeds the
  // three button counts, the "not set" warning, and the item picker exclusions.
  const loadPrices = useCallback(async () => {
    if (!businessId) return;
    setError('');
    try {
      setRows(await superAdminApi.getBusinessPrices(businessId, laundryType));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the price list');
    }
  }, [businessId, laundryType]);

  useFocusEffect(useCallback(() => { loadBusinesses(); }, [loadBusinesses]));
  // On focus too, so the button counts and the "not set" warning refresh after
  // a price is changed on the list page and the admin comes back.
  useFocusEffect(useCallback(() => { loadPrices(); }, [loadPrices]));

  const unsetCount = useMemo(() => rows.filter((row) => row.price === null).length, [rows]);

  /** Open the Category page for one of the three lists, remembering which for
   *  the button highlight on return. Category -> Sub-category -> Items follows
   *  from there. */
  const openList = (which: Filter) => {
    setFilter(which);
    navigation.navigate('SuperAdminBusinessPriceBrowse', {
      businessId,
      businessName: business?.business_name ?? '',
      laundryType,
      laundryTypeLabel,
      filter: which,
    });
  };

  /**
   * Print THIS business's rate card, at the laundry type on screen.
   *
   * Both are already chosen above and every row belongs to them, so the sheet
   * needs no further asking: it is "these rates, for this business, for this
   * type". The other laundry type is a separate sheet, printed by switching
   * the selector — never two rates for one item on one page.
   *
   * The Category -> Sub-category filters are NOT applied. They narrow the
   * screen so one item can be found; the printed card is the whole list.
   */
  const printList = () => {
    if (!businessId || printing) return;
    const label = LAUNDRY_TYPES.find((t) => t.value === laundryType)?.label ?? '';
    // The business row is only needed for what the dialogs call it. The sheet
    // itself is named by the server from the stored record, so a list that has
    // not finished loading must not block the print.
    const name = business?.business_name ?? 'this business';

    const run = async (includeUnset: boolean) => {
      setPrinting(true);
      setError('');
      const { error: failure } = await printPriceListPdf(
        superAdminApi.businessPriceListPdfUrl(businessId, laundryType, includeUnset),
        `swachham-price-list-${businessId}-${laundryType}.pdf`,
        `${name} — ${label}`
      );
      if (failure) setError(failure);
      setPrinting(false);
    };

    // The unpriced items are the one real choice here, so it is asked rather
    // than decided: a card handed to the business should not list items it
    // has no rate for, but a working copy chasing the gaps should.
    if (unsetCount === 0) {
      run(false);
      return;
    }

    Alert.alert(
      `Print ${label} rates`,
      `${name}\n\n` +
        `${unsetCount} item(s) have no rate for this laundry type. Leave them off ` +
        'for a card to hand over, include them to see the gaps on paper.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Priced items only', onPress: () => run(false) },
        { text: 'Include not set', onPress: () => run(true) },
      ]
    );
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={sa.headerTitle}>Business Price List</Text>
      </View>

      {/* Select Business, first and always visible: every figure below
          belongs to exactly one business. */}
      <View style={{ paddingHorizontal: SPACING.md }}>
        <Text style={sa.label}>SELECT BUSINESS</Text>
        <TouchableOpacity
          style={[sa.input, { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }]}
          onPress={() => setPicking(true)}
          accessibilityLabel="Select a business"
        >
          <Ionicons name="business-outline" size={18} color={COLORS.Primary} />
          <Text
            style={{
              flex: 1,
              fontFamily: TYPOGRAPHY.fontFamily,
              fontSize: TYPOGRAPHY.sizes.base,
              color: business ? COLORS.TextPrimary : COLORS.TextSecondary,
            }}
            numberOfLines={1}
          >
            {business ? business.business_name : 'Choose a business'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={COLORS.TextSecondary} />
        </TouchableOpacity>
      </View>

      {!businessId ? (
        <Text style={sa.empty}>Select a business to see and edit its prices.</Text>
      ) : (
        <>
          {/* Laundry type. Hotel and Guest are priced separately, so the
              table shows one at a time and this switches between them. */}
          <View style={{ paddingHorizontal: SPACING.md }}>
            <Text style={sa.label}>LAUNDRY TYPE</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.xs }}>
              {LAUNDRY_TYPES.map((type) => {
                const on = laundryType === type.value;
                return (
                  <TouchableOpacity
                    key={type.value}
                    style={[sa.tab, on && sa.tabActive, { flex: 1 }]}
                    onPress={() => {
                      setLaundryType(type.value);
                      setFilter('all');
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[sa.tabText, on && sa.tabTextActive]}>{type.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* The explicit way in. Adding is its own action rather than only
              being reachable by finding a "Not set" row in the table. */}
          <TouchableOpacity
            style={[
              sa.addEntryBtn,
              { marginTop: SPACING.md, marginHorizontal: SPACING.md },
            ]}
            onPress={() => setAddingNew(true)}
            accessibilityLabel="Add new price entry"
          >
            <Ionicons name="add" size={20} color={COLORS.Surface} />
            <Text style={sa.addEntryText}>Add New Entry</Text>
          </TouchableOpacity>

          {/* The rate card for the business and laundry type chosen above.
              Secondary to adding a price, and available as soon as a business
              is picked — it does not wait for the category filters, because
              the sheet is the whole list rather than what the table shows. */}
          <TouchableOpacity
            style={[
              sa.buttonGhost,
              {
                marginHorizontal: SPACING.md,
                flexDirection: 'row',
                justifyContent: 'center',
                gap: SPACING.xs,
              },
            ]}
            onPress={printList}
            disabled={printing}
            accessibilityRole="button"
            accessibilityLabel={`Print this business's ${
              LAUNDRY_TYPES.find((t) => t.value === laundryType)?.label ?? ''
            } price list`}
            accessibilityState={{ disabled: printing }}
          >
            {printing ? (
              <ActivityIndicator size="small" color={COLORS.TextPrimary} />
            ) : (
              <Ionicons name="print-outline" size={18} color={COLORS.TextPrimary} />
            )}
            <Text style={sa.buttonGhostText}>
              {printing
                ? 'Preparing…'
                : `Print ${LAUNDRY_TYPES.find((t) => t.value === laundryType)?.label ?? ''} List`}
            </Text>
          </TouchableOpacity>

          {/* All / Priced / Not set. Each opens its own page — the item list
              lives on SuperAdminBusinessPricesListScreen now. The tapped one
              stays highlighted for when the admin comes back. */}
          <View style={[sa.tabs, { paddingTop: SPACING.md }]}>
            <FilterTab label={`All (${rows.length})`} on={filter === 'all'} onPress={() => openList('all')} />
            <FilterTab
              label={`Priced (${rows.length - unsetCount})`}
              on={filter === 'set'}
              onPress={() => openList('set')}
            />
            <FilterTab
              label={`Not set (${unsetCount})`}
              on={filter === 'unset'}
              onPress={() => openList('unset')}
            />
          </View>

          {!!error && (
            <View style={[sa.errorBox, { marginHorizontal: SPACING.md }]}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
              <Text style={sa.errorText}>{error}</Text>
            </View>
          )}

          {unsetCount > 0 && (
            <View style={[sa.warnBox, { marginHorizontal: SPACING.md }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#8A5200" />
              <Text style={sa.warnText}>
                {unsetCount} item{unsetCount === 1 ? '' : 's'} have no{' '}
                {laundryTypeLabel} price for this business. Orders at this laundry
                type containing them will be refused.
              </Text>
            </View>
          )}
        </>
      )}

      {/* Business picker */}
      <Modal visible={picking} animationType="slide" transparent onRequestClose={() => setPicking(false)}>
        <View style={sa.modalBackdrop}>
          <View style={sa.modalSheet}>
            <View style={sa.header}>
              <Text style={[sa.headerTitle, { flex: 1 }]}>Select business</Text>
              <TouchableOpacity style={sa.iconBtn} onPress={() => setPicking(false)}>
                <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={sa.scroll}>
              {businesses.length === 0 && <Text style={sa.empty}>No businesses yet.</Text>}
              {businesses.map((b) => (
                <TouchableOpacity
                  key={b.business_id}
                  style={[sa.choice, businessId === b.business_id && sa.choiceActive]}
                  onPress={() => {
                    setBusinessId(b.business_id);
                    setPicking(false);
                  }}
                >
                  <Ionicons
                    name={businessId === b.business_id ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={businessId === b.business_id ? COLORS.Primary : COLORS.TextSecondary}
                  />
                  <Text style={sa.choiceText} numberOfLines={1}>{b.business_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* "+ Add New Entry" only. Row-level Set/Adjust now happens on the list
         page. `row` is always null here — this sheet is the add path. */}
      <BusinessPriceModal
        businessId={businessId}
        businessName={business?.business_name || ''}
        laundryType={laundryType}
        laundryTypeLabel={laundryTypeLabel}
        row={null}
        addingNew={addingNew}
        /* Items already priced at THIS laundry type, so the picker can leave
           them out — adding one again would only 409. */
        pricedItemIds={rows.filter((r) => r.price !== null).map((r) => r.item_id)}
        onClose={() => setAddingNew(false)}
        onSaved={() => { setAddingNew(false); loadPrices(); }}
      />
    </SafeAreaView>
  );
}

function FilterTab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[sa.tab, on && sa.tabActive]} onPress={onPress}>
      <Text style={[sa.tabText, on && sa.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  const tone = active ? STATUS_TONE.ACTIVE : STATUS_TONE.INACTIVE;
  return (
    <View style={[sa.pill, { backgroundColor: tone.bg }]}>
      <Text style={[sa.pillText, { color: tone.fg }]}>{active ? 'ACTIVE' : 'DISABLED'}</Text>
    </View>
  );
}

/* ===================================================================
 * SET / EDIT ONE BUSINESS PRICE
 * =================================================================== */

interface ModalProps {
  businessId: string | null;
  businessName: string;
  laundryType: LaundryTypeValue;
  laundryTypeLabel: string;
  row: BusinessPrice | null;
  /** True when opened by "+ Add New Entry" rather than by a row's action. */
  addingNew: boolean;
  /** Already priced at this laundry type — excluded from the picker. */
  pricedItemIds: string[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Sets this business's price for one item at one laundry type.
 *
 * Three jobs, one sheet: change an existing price (PUT), set the price of a
 * row that shows "Not set" (POST), and "+ Add New Entry", which is the same
 * POST reached by picking the item here instead of finding it in the table.
 *
 * The laundry type is fixed by the table the sheet was opened from and is
 * shown, not chosen again — that is what stops a Guest price being saved
 * while the Hotel table is on screen.
 */
export function BusinessPriceModal({
  businessId,
  businessName,
  laundryType,
  laundryTypeLabel,
  row,
  addingNew,
  pricedItemIds,
  onClose,
  onSaved,
}: ModalProps) {
  const [price, setPrice] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Only used by the "+ Add New Entry" path, where no row was given. */
  const [pickedItemId, setPickedItemId] = useState<string>('');
  const [pickedItemName, setPickedItemName] = useState<string>('');

  const visible = row !== null || addingNew;

  React.useEffect(() => {
    if (!visible) return;
    setError('');
    setPickedItemName('');
    if (row) {
      setPrice(row.price === null ? '' : String(row.price));
      setActive(row.id === null ? true : row.is_active);
      setPickedItemId(row.item_id);
    } else {
      setPrice('');
      setActive(true);
      setPickedItemId('');
    }
  }, [visible, row]);

  const save = async () => {
    if (!businessId) return;
    const itemId = row ? row.item_id : pickedItemId;
    if (!itemId) return;

    setBusy(true);
    setError('');
    try {
      if (row?.id) {
        await superAdminApi.updateBusinessPrice(businessId, row.id, {
          price,
          is_active: active,
        });
      } else {
        // The laundry type comes from the table that was open, never from a
        // second control here, so what is saved is what was on screen.
        await superAdminApi.createBusinessPrice(businessId, {
          item_id: itemId,
          laundry_type: laundryType,
          price,
          is_active: active,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sa.modalBackdrop}>
        <View style={sa.modalSheet}>
          <View style={sa.header}>
            <Text style={[sa.headerTitle, { flex: 1 }]}>
              {row?.id ? 'Edit business price' : 'Add price entry'}
            </Text>
            <TouchableOpacity style={sa.iconBtn} onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.TextPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
            {!!error && (
              <View style={sa.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
                <Text style={sa.errorText}>{error}</Text>
              </View>
            )}

            {row ? (
              <View style={sa.card}>
                <Text style={sa.cardTitle}>{row.item_name}</Text>
                <Text style={sa.cardMeta}>
                  {businessName} · {laundryTypeLabel}
                </Text>
                {/* Reference only. Stated as such, so it is never mistaken
                    for a value this business will be charged. */}
                <Text style={sa.cardLine}>
                  Customer price: {money(row.customer_price)}{' '}
                  <Text style={sa.tdMuted}>(reference only — not used for this business)</Text>
                </Text>
              </View>
            ) : (
              <>
                <View style={sa.card}>
                  <Text style={sa.cardTitle}>{businessName}</Text>
                  {/* The type is stated, not chosen again: it is whichever
                      table this sheet was opened from. */}
                  <Text style={sa.cardMeta}>{laundryTypeLabel}</Text>
                  {/* What has been chosen so far, so the price field below is
                      never entered against a forgotten item. */}
                  {pickedItemName ? (
                    <Text style={sa.cardLine}>Item: {pickedItemName}</Text>
                  ) : null}
                </View>

                {/* Category -> Sub-category -> Item, dependent. Items already
                    priced at this laundry type are left out, so a selection
                    here can never produce a duplicate. */}
                <CategoryItemPicker
                  excludeItemIds={pricedItemIds}
                  selectedItemId={pickedItemId}
                  onSelectItem={(id, item) => {
                    setPickedItemId(id);
                    setPickedItemName(item?.name || '');
                  }}
                />
              </>
            )}

            <Text style={sa.label}>
              {laundryTypeLabel.toUpperCase()} PRICE (₹) <Text style={sa.required}>*</Text>
            </Text>
            <TextInput
              style={sa.input}
              placeholder="0.00"
              placeholderTextColor={COLORS.TextSecondary}
              keyboardType="decimal-pad"
              value={price}
              onChangeText={setPrice}
              /* Focused only when the item is already settled; on the add
                 path the item picker comes first. */
              autoFocus={Boolean(row)}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: SPACING.md,
                gap: SPACING.sm,
              }}
            >
              <Switch
                value={active}
                onValueChange={setActive}
                trackColor={{ true: COLORS.PrimaryLight, false: COLORS.Border }}
                thumbColor={active ? COLORS.Primary : COLORS.Surface}
              />
              <Text
                style={{
                  flex: 1,
                  fontFamily: TYPOGRAPHY.fontFamily,
                  fontSize: TYPOGRAPHY.sizes.sm,
                  color: COLORS.TextPrimary,
                }}
              >
                {active
                  ? `Active — billed at this price for ${laundryTypeLabel}`
                  : 'Disabled — orders with this item at this laundry type will be refused'}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                sa.button,
                (price.trim() === '' || (!row && !pickedItemId) || busy) && sa.buttonDisabled,
              ]}
              onPress={save}
              disabled={price.trim() === '' || (!row && !pickedItemId) || busy}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.Surface} />
              ) : (
                <Text style={sa.buttonText}>Save price</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={sa.buttonGhost} onPress={onClose}>
              <Text style={sa.buttonGhostText}>Cancel</Text>
            </TouchableOpacity>

            <View style={{ height: BORDER_RADIUS.xxl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

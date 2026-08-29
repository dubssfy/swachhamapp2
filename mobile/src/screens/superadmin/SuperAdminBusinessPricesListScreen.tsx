import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
  TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../../constants/theme';
import { sa } from './styles';
import superAdminApi, { BusinessPrice, LaundryTypeValue } from '../../services/superAdminApi';
import { ActionButton } from './SuperAdminCustomerPricesScreen';
import PriceCategoryGroups, { PriceItemRow } from './PriceCategoryGroups';
import { BusinessPriceModal, StatusPill } from './SuperAdminBusinessPricesScreen';

/**
 * Business Price List — the item list for ONE sub-category (or a flat
 * category), on its own page.
 *
 * The Business Price List screen chooses the business, laundry type and the
 * All / Priced / Not set button; the Category and Sub-category pages choose
 * the category and sub-category; all of it arrives here as route params. This
 * screen owns the search box, the grouped item list, and the per-row Set /
 * Adjust / Enable / Disable / Delete actions and the price sheet. Nothing
 * about the data, the API calls or the pricing logic changed.
 *
 * Back returns to the Sub-category page, which stayed mounted.
 */

type Filter = 'all' | 'set' | 'unset';

const FILTER_TITLE: Record<Filter, string> = {
  all: 'All items',
  set: 'Priced items',
  unset: 'Items not set',
};

const money = (value: number | null) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toFixed(2)}`;

interface Params {
  businessId?: string;
  businessName?: string;
  laundryType?: LaundryTypeValue;
  laundryTypeLabel?: string;
  filter?: Filter;
  categoryId?: string;
  categoryName?: string;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
}

export default function SuperAdminBusinessPricesListScreen({ navigation, route }: any) {
  const params: Params = route?.params ?? {};
  const businessId = params.businessId ?? null;
  const businessName = params.businessName ?? '';
  const laundryType: LaundryTypeValue = params.laundryType === 'guest' ? 'guest' : 'hotel';
  const laundryTypeLabel = params.laundryTypeLabel ?? '';
  const filter: Filter = params.filter ?? 'all';
  const categoryId = params.categoryId ?? null;
  const categoryName = params.categoryName ?? '';
  const subcategoryId = params.subcategoryId ?? null;
  const subcategoryName = params.subcategoryName ?? null;

  const [rows, setRows] = useState<BusinessPrice[]>([]);
  const [search, setSearch] = useState('');
  // Starts true so the first paint is a spinner, not an empty "no items" list.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<BusinessPrice | null>(null);

  const loadPrices = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError('');
    try {
      setRows(await superAdminApi.getBusinessPrices(businessId, laundryType));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Could not load the price list');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, laundryType]);

  React.useEffect(() => { loadPrices(); }, [loadPrices]);

  /*
   * "Not set" means NOTHING WOULD BE BILLED for this item + service — an
   * order for it is refused. A service with no rate of its own but an
   * inherited base rate is not counted: it bills that rate, so listing it as
   * needing attention would send the operator after a price that already
   * works. This is the same test the row's own "Not set" label uses.
   */
  const unsetCount = useMemo(
    () => rows.filter((row) => row.effective_price === null).length,
    [rows]
  );

  /**
   * Which SERVICES each item is already priced for, at this laundry type.
   *
   * Keyed by item id; the set holds a service id per per-service rate, plus
   * the literal 'base' when the item has a rate that covers every service.
   * The Add sheet uses it to leave out services that would only 409.
   */
  const pricedServicesByItem = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      if (row.price === null) continue;
      const key = row.service_id ?? 'base';
      (map[row.item_id] ??= []).push(key);
    }
    return map;
  }, [rows]);

  /**
   * Items with NOTHING LEFT TO PRICE — the ones the item picker leaves out.
   *
   * An item is exhausted when every slot it has is filled: its base rate and
   * one rate per service it is offered for. A single-service item keeps its
   * old behaviour — one price retires it — because a per-service rate on an
   * item with a single service would only restate the base rate.
   */
  const exhaustedItemIds = useMemo(() => {
    const seen = new Map<string, { used: Set<string>; services: number }>();
    for (const row of rows) {
      const entry = seen.get(row.item_id) ?? {
        used: new Set<string>(),
        services: row.service_types.length,
      };
      if (row.price !== null) entry.used.add(row.service_id ?? 'base');
      seen.set(row.item_id, entry);
    }
    const out: string[] = [];
    for (const [itemId, { used, services }] of seen) {
      if (used.size === 0) continue;
      // Single-service (or unclassified) items: any price retires them.
      if (services <= 1) { out.push(itemId); continue; }
      // Multi-service: the base slot plus one per service.
      if (used.size >= services + 1) out.push(itemId);
    }
    return out;
  }, [rows]);

  // The category and sub-category are chosen on the pages before this one and
  // arrive as route params, so the list is narrowed to exactly them plus the
  // All / Priced / Not set button and the search box.
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      // Set / Not set on what would ACTUALLY be billed, matching the label
      // the row itself shows — see `unsetCount`.
      if (filter === 'set' && row.effective_price === null) return false;
      if (filter === 'unset' && row.effective_price !== null) return false;
      if (categoryId) {
        const id = row.parent_category_id || row.category_id;
        if (id !== categoryId) return false;
      }
      if (subcategoryId && row.category_id !== subcategoryId) return false;
      if (!needle) return true;
      return (
        row.item_name.toLowerCase().includes(needle) ||
        (row.category_name || '').toLowerCase().includes(needle) ||
        (row.parent_category_name || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, search, filter, categoryId, subcategoryId]);

  /**
   * The visible rows, gathered into ONE GROUP PER ITEM.
   *
   * The API returns a line per item PER SERVICE, which is the right shape for
   * pricing but the wrong one to read: the item's name would repeat down the
   * list once for every service it is offered for. Grouping puts the name
   * once at the head of a card and its services underneath, so the Super
   * Admin sees each item and chooses which of its services to price.
   *
   * Order is preserved exactly as the server sent it — the categories are
   * already sorted, and re-sorting here could only disagree with the
   * headings the list is grouped under.
   */
  const itemGroups = useMemo(() => {
    const groups: Array<{ item_id: string; head: BusinessPrice; lines: BusinessPrice[] }> = [];
    const index = new Map<string, number>();
    for (const row of shown) {
      const at = index.get(row.item_id);
      if (at === undefined) {
        index.set(row.item_id, groups.length);
        groups.push({ item_id: row.item_id, head: row, lines: [row] });
      } else {
        groups[at].lines.push(row);
      }
    }
    return groups;
  }, [shown]);

  const toggleActive = async (row: BusinessPrice) => {
    if (!businessId || !row.id) return;
    try {
      await superAdminApi.updateBusinessPrice(businessId, row.id, { is_active: !row.is_active });
      loadPrices();
    } catch (e: any) {
      Alert.alert('Could not update', e?.response?.data?.message || e.message);
    }
  };

  const confirmDelete = (row: BusinessPrice) => {
    if (!businessId || !row.id) return;
    Alert.alert(
      'Remove this price?',
      `${row.item_name} · ${row.service_label} · ${row.laundry_type_label} — ` +
        `${money(row.price)} for ${businessName || 'this business'}.\n\n` +
        'Only this service at this laundry type is affected; the other service ' +
        'and the other laundry type keep their own prices. Past orders keep the ' +
        'price they were placed at. Without a price, this business cannot order ' +
        'the item for this service until one is set again — unless the item has ' +
        'a rate covering every service, which this service would then fall back to.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          onPress: async () => {
            try {
              await superAdminApi.deleteBusinessPrice(businessId, row.id!);
              loadPrices();
            } catch (e: any) {
              Alert.alert('Could not disable', e?.response?.data?.message || e.message);
            }
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await superAdminApi.deleteBusinessPrice(businessId, row.id!, true);
              loadPrices();
            } catch (e: any) {
              Alert.alert('Could not delete', e?.response?.data?.message || e.message);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={sa.container} edges={['top']}>
      <View style={sa.header}>
        <TouchableOpacity style={sa.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={sa.headerTitle}>{FILTER_TITLE[filter]}</Text>
      </View>

      {businessName || laundryTypeLabel ? (
        <Text style={[sa.cardMeta, { paddingHorizontal: SPACING.md }]}>
          {businessName}
          {businessName && laundryTypeLabel ? ' · ' : ''}
          {laundryTypeLabel}
        </Text>
      ) : null}

      {categoryName ? (
        <Text style={[sa.cardMeta, { paddingHorizontal: SPACING.md }]}>
          {categoryName}
          {subcategoryName ? ` › ${subcategoryName}` : ''}
        </Text>
      ) : null}

      {!businessId ? (
        <Text style={sa.empty}>Select a business first.</Text>
      ) : (
        <>
          <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.sm }}>
            <TextInput
              style={sa.input}
              placeholder="Search items"
              placeholderTextColor={COLORS.TextSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {filter === 'unset' && unsetCount > 0 && (
            <View style={[sa.warnBox, { marginHorizontal: SPACING.md }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#8A5200" />
              <Text style={sa.warnText}>
                {/* Lines, and they are named as such: the list holds one line
                    per item PER SERVICE, so "12 items" would overstate a
                    count that is really 12 item-and-service combinations. */}
                {unsetCount} item/service line{unsetCount === 1 ? '' : 's'} have no{' '}
                {laundryTypeLabel} price for this business. Orders at this laundry
                type for those services will be refused.
              </Text>
            </View>
          )}

          {loading ? (
            <View style={sa.centered}>
              <ActivityIndicator size="large" color={COLORS.Primary} />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={sa.scroll}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); loadPrices(); }}
                />
              }
            >
              {!!error && (
                <View style={sa.errorBox}>
                  <Ionicons name="alert-circle-outline" size={16} color={COLORS.Error} />
                  <Text style={sa.errorText}>{error}</Text>
                </View>
              )}

              {shown.length === 0 ? (
                <Text style={sa.empty}>
                  {search.trim() !== ''
                    ? 'No item matches that search.'
                    : filter === 'set'
                      ? 'No priced items here.'
                      : filter === 'unset'
                        ? 'Every item here has a price.'
                        : 'No items here.'}
                </Text>
              ) : (
                /* Main Category -> Sub-category -> Items. The category and
                   sub-category are the headings, so each row carries only what
                   is actually specific to it: the item, its rates, and what can
                   be done to it. */
                <PriceCategoryGroups
                  /* ONE CARD PER ITEM, with the item's services inside it.
                     The item is named ONCE; each service it is offered for
                     gets its own line and its own price beneath that name,
                     rather than the item repeating down the list once per
                     service. See `itemGroups`. */
                  rows={itemGroups}
                  keyOf={(group) => group.item_id}
                  topIdOf={(group) => group.head.parent_category_id || group.head.category_id}
                  topNameOf={(group) => group.head.parent_category_name || group.head.category_name}
                  subIdOf={(group) =>
                    group.head.parent_category_id ? group.head.category_id : null}
                  subNameOf={(group) =>
                    group.head.parent_category_id ? group.head.category_name : null}
                  expandAll
                  renderItem={(group) => (
                    <PriceItemRow
                      title={group.head.item_name}
                      subtitle={
                        <View style={{ marginTop: 2 }}>
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: SPACING.xs,
                            }}
                          >
                            {/* The reference figure, never a fallback: the
                                backend refuses to price an order from it. */}
                            <Text style={sa.tdMuted}>
                              Customer: {money(group.head.customer_price)}
                            </Text>
                            {!group.head.item_is_active ? (
                              <Text style={[sa.tdMuted, { color: COLORS.Warning, fontSize: 10 }]}>
                                item disabled
                              </Text>
                            ) : null}
                          </View>

                          {/* ---- ONE LINE PER SERVICE ----
                              Each is set independently: the price shown is
                              what an order for THAT service is billed, and
                              the button beside it acts on that service
                              alone. */}
                          {group.lines.map((line) => (
                            <ServicePriceLine
                              key={line.service_id ?? 'base'}
                              line={line}
                              onSet={() => setEditing(line)}
                              onToggle={() => toggleActive(line)}
                              onDelete={() => confirmDelete(line)}
                            />
                          ))}
                        </View>
                      }
                    />
                  )}
                />
              )}
            </ScrollView>
          )}
        </>
      )}

      <BusinessPriceModal
        businessId={businessId}
        businessName={businessName}
        laundryType={laundryType}
        laundryTypeLabel={laundryTypeLabel}
        row={editing}
        addingNew={false}
        /* Items with NOTHING LEFT TO PRICE at this laundry type, so the
           picker can leave them out — adding one again would only 409.

           "Nothing left" is per SERVICE, not per item. An item offered for
           Wash & Iron and Dry Clean can hold a base rate plus a rate for
           each service, so it stays offerable until every one of those
           exists. Excluding it the moment it had any price — which is what
           this did before per-service rates — made a Dry Clean override
           impossible to add through this sheet, because the item it belonged
           to had vanished from the picker.

           A single-service item is unchanged: its base rate is its only
           meaningful rate, so one price still retires it. */
        pricedItemIds={exhaustedItemIds}
        /* Which services each item has already been priced for, so the
           dropdown can leave those out too. */
        pricedServicesByItem={pricedServicesByItem}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); loadPrices(); }}
      />
    </SafeAreaView>
  );
}

/**
 * ONE SERVICE OF ONE ITEM, and the price set against it.
 *
 *   Wash & Iron    55.00    [Adjust] [Disable] [Delete]
 *   Dry Clean      Not set  [Set]
 *
 * Everything here acts on THIS SERVICE ALONE — the buttons carry the line's
 * own price row, so adjusting Dry Clean cannot touch Wash & Iron.
 *
 * The figure shown is `effective_price`: what an order for this service is
 * actually billed. A service with no rate of its own but an item-wide rate
 * behind it shows that rate, marked inherited, because printing "Not set"
 * beside a service the system charges 45.00 for would be false. "Not set" is
 * kept for a service that genuinely has no price — one an order is refused
 * for rather than guessed at.
 */
function ServicePriceLine({
  line,
  onSet,
  onToggle,
  onDelete,
}: {
  line: BusinessPrice;
  onSet: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const unpriced = line.effective_price === null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: SPACING.xs,
        marginTop: SPACING.xs,
        paddingTop: SPACING.xs,
        borderTopWidth: 1,
        borderTopColor: COLORS.Border,
      }}
    >
      <View style={[sa.pill, { backgroundColor: COLORS.PrimaryLight }]}>
        <Text style={[sa.pillText, { color: COLORS.Primary }]}>{line.service_label}</Text>
      </View>

      <Text
        style={[
          sa.tdPrice,
          unpriced && { color: COLORS.Warning },
          line.is_inherited && { color: COLORS.TextSecondary },
        ]}
      >
        {unpriced ? 'Not set' : money(line.effective_price)}
      </Text>

      {line.is_inherited ? (
        <Text style={[sa.tdMuted, { fontSize: 10 }]}>inherited</Text>
      ) : null}
      {line.price !== null ? <StatusPill active={line.is_active} /> : null}

      <View style={{ flexDirection: 'row', gap: SPACING.xs, marginLeft: 'auto' }}>
        {/* "Set" until this SERVICE has a rate of its own — an inherited
            figure belongs to the item, not to this service. */}
        <ActionButton
          icon={line.price === null ? 'add-circle-outline' : 'create-outline'}
          label={line.price === null ? 'Set' : 'Adjust'}
          tone="primary"
          onPress={onSet}
          accessibilityLabel={`${line.price === null ? 'Set' : 'Adjust'} the ${
            line.service_label
          } price for ${line.item_name}`}
        />
        {/* Enable/Disable and Delete need a row of this service's own: an
            inherited figure has no row here to enable or remove. */}
        {line.id !== null && line.price !== null && (
          <>
            <ActionButton
              icon={line.is_active ? 'close-circle-outline' : 'checkmark-circle-outline'}
              label={line.is_active ? 'Disable' : 'Enable'}
              onPress={onToggle}
              accessibilityLabel={`${line.is_active ? 'Disable' : 'Enable'} the ${
                line.service_label
              } price for ${line.item_name}`}
            />
            <ActionButton
              icon="trash-outline"
              label="Delete"
              tone="danger"
              onPress={onDelete}
              accessibilityLabel={`Remove the ${line.service_label} price for ${line.item_name}`}
            />
          </>
        )}
      </View>
    </View>
  );
}

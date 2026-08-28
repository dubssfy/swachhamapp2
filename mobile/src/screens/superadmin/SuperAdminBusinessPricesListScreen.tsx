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

  const unsetCount = useMemo(() => rows.filter((row) => row.price === null).length, [rows]);

  // The category and sub-category are chosen on the pages before this one and
  // arrive as route params, so the list is narrowed to exactly them plus the
  // All / Priced / Not set button and the search box.
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'set' && row.price === null) return false;
      if (filter === 'unset' && row.price !== null) return false;
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
      `${row.item_name} · ${row.laundry_type_label} — ${money(row.price)} for ` +
        `${businessName || 'this business'}.\n\n` +
        'Only this laundry type is affected; the other one keeps its own price. ' +
        'Past orders keep the price they were placed at. Without a price, this ' +
        'business cannot order the item at this laundry type until one is set again.',
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
                {unsetCount} item{unsetCount === 1 ? '' : 's'} have no{' '}
                {laundryTypeLabel} price for this business. Orders at this laundry
                type containing them will be refused.
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
                  rows={shown}
                  keyOf={(row) => String(row.item_id)}
                  topIdOf={(row) => row.parent_category_id || row.category_id}
                  topNameOf={(row) => row.parent_category_name || row.category_name}
                  subIdOf={(row) => (row.parent_category_id ? row.category_id : null)}
                  subNameOf={(row) => (row.parent_category_id ? row.category_name : null)}
                  expandAll
                  renderItem={(row) => (
                    <PriceItemRow
                      title={row.item_name}
                      subtitle={
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: SPACING.xs,
                            marginTop: 2,
                          }}
                        >
                          {/* The reference figure, never a fallback: the
                              backend refuses to price an order from it. */}
                          <Text style={sa.tdMuted}>
                            Customer: {money(row.customer_price)}
                          </Text>
                          {row.price === null ? null : <StatusPill active={row.is_active} />}
                          {!row.item_is_active ? (
                            <Text style={[sa.tdMuted, { color: COLORS.Warning, fontSize: 10 }]}>
                              item disabled
                            </Text>
                          ) : null}
                        </View>
                      }
                      right={
                        row.price === null ? (
                          <Text style={[sa.tdPrice, { color: COLORS.Warning }]}>Not set</Text>
                        ) : (
                          <Text style={sa.tdPrice}>{money(row.price)}</Text>
                        )
                      }
                      actions={
                        <>
                          <ActionButton
                            icon={row.price === null ? 'add-circle-outline' : 'create-outline'}
                            label={row.price === null ? 'Set' : 'Adjust'}
                            tone="primary"
                            onPress={() => setEditing(row)}
                            accessibilityLabel={
                              row.price === null
                                ? `Set price for ${row.item_name}`
                                : `Adjust price for ${row.item_name}`
                            }
                          />
                          {/* Enable/Disable and Delete need a row to act on:
                              an item with no price for this business has
                              nothing to enable or remove yet. */}
                          {row.id !== null && (
                            <>
                              <ActionButton
                                icon={
                                  row.is_active
                                    ? 'close-circle-outline'
                                    : 'checkmark-circle-outline'
                                }
                                label={row.is_active ? 'Disable' : 'Enable'}
                                onPress={() => toggleActive(row)}
                                accessibilityLabel={
                                  row.is_active
                                    ? `Disable price for ${row.item_name}`
                                    : `Enable price for ${row.item_name}`
                                }
                              />
                              <ActionButton
                                icon="trash-outline"
                                label="Delete"
                                tone="danger"
                                onPress={() => confirmDelete(row)}
                                accessibilityLabel={`Remove price for ${row.item_name}`}
                              />
                            </>
                          )}
                        </>
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
        /* Items already priced at THIS laundry type, so the picker can leave
           them out — adding one again would only 409. */
        pricedItemIds={rows.filter((r) => r.price !== null).map((r) => r.item_id)}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); loadPrices(); }}
      />
    </SafeAreaView>
  );
}

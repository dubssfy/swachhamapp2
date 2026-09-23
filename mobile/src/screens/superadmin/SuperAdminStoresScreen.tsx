import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import superAdminApi, { AdminStore, StorePayload } from '../../services/superAdminApi';
import { extractErrorMessage } from '../../services/api';

/**
 * STORE MANAGEMENT.
 *
 * The Swachham locations the customer-facing Store Locator lists. Everything
 * here writes to the `stores` table through the Super Admin API, and the
 * locator reads that same table on every fetch — so a store added, hidden or
 * shown here reaches the locator without any frontend change or redeploy.
 * There is no local array and nothing cached.
 *
 * Validation is duplicated between this form and the server on purpose: this
 * copy is for a fast, friendly message, and the server's copy is the one that
 * actually protects the table, because the endpoint can be called without
 * this screen.
 */

type FormState = {
  name: string;
  address: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  contact_number: string;
  email: string;
  latitude: string;
  longitude: string;
  opening_time: string;
  closing_time: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  address: '',
  city: '',
  district: '',
  state: '',
  pincode: '',
  contact_number: '',
  email: '',
  latitude: '',
  longitude: '',
  opening_time: '',
  closing_time: '',
  is_active: true,
};

/** Trims "HH:MM:SS" to the "HH:MM" the form edits. */
function toFormTime(value: string | null): string {
  return value ? value.slice(0, 5) : '';
}

function formFor(store: AdminStore): FormState {
  return {
    name: store.name ?? '',
    address: store.address ?? '',
    city: store.city ?? '',
    district: store.district ?? '',
    state: store.state ?? '',
    pincode: store.pincode ?? '',
    contact_number: store.contact_number ?? '',
    email: store.email ?? '',
    latitude: String(store.latitude ?? ''),
    longitude: String(store.longitude ?? ''),
    opening_time: toFormTime(store.opening_time),
    closing_time: toFormTime(store.closing_time),
    is_active: Boolean(store.is_active),
  };
}

/**
 * The same rules the server enforces, so the common mistakes are caught before
 * a round trip. Returns the first problem, or null.
 */
function validate(form: FormState): string | null {
  if (!form.name.trim()) return 'Store name is required.';
  if (!form.address.trim()) return 'Address is required.';
  if (!form.city.trim()) return 'City is required.';
  if (!form.contact_number.trim()) return 'Contact number is required.';

  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return 'Latitude must be a number between -90 and 90.';
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return 'Longitude must be a number between -180 and 180.';
  }

  if (form.pincode.trim() && !/^[0-9]{6}$/.test(form.pincode.trim())) {
    return 'Pincode must be 6 digits.';
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
    return 'Email address is not valid.';
  }
  for (const [label, value] of [
    ['Opening time', form.opening_time],
    ['Closing time', form.closing_time],
  ] as const) {
    if (value.trim() && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim())) {
      return `${label} must be in 24-hour HH:MM form, for example 09:00.`;
    }
  }
  return null;
}

/** Empty optional fields are sent as null so the server clears them. */
function payloadFrom(form: FormState): StorePayload {
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    name: form.name.trim(),
    address: form.address.trim(),
    city: form.city.trim(),
    district: orNull(form.district),
    state: orNull(form.state),
    pincode: orNull(form.pincode),
    contact_number: form.contact_number.trim(),
    email: orNull(form.email),
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    opening_time: orNull(form.opening_time),
    closing_time: orNull(form.closing_time),
    is_active: form.is_active,
  };
}

export default function SuperAdminStoresScreen() {
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminStore | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus((current) => (current === 'ready' ? 'ready' : 'loading'));
      setError('');
      setStores(await superAdminApi.listStores());
      setStatus('ready');
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load stores'));
      setStatus('error');
    }
  }, []);

  // Reloads whenever the tab regains focus, so a change made elsewhere shows.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (store: AdminStore) => {
    setEditing(store);
    setForm(formFor(store));
    setFormOpen(true);
  };

  const save = async () => {
    const problem = validate(form);
    if (problem) {
      Alert.alert('Check the form', problem);
      return;
    }

    setSaving(true);
    try {
      const payload = payloadFrom(form);
      const saved = editing
        ? await superAdminApi.updateStore(editing.id, payload)
        : await superAdminApi.createStore(payload);

      setFormOpen(false);
      await load();
      Alert.alert(
        editing ? 'Store updated' : 'Store added',
        `"${saved.name}" has been saved.` +
          (saved.is_active
            ? ' It is now visible in the Store Locator.'
            : ' It is inactive, so it stays hidden from the Store Locator until you activate it.')
      );
    } catch (err) {
      // 409 from a duplicate name arrives here with the server's wording.
      Alert.alert('Could not save', extractErrorMessage(err, 'Could not save the store'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (store: AdminStore) => {
    setBusyId(store.id);
    try {
      const updated = await superAdminApi.setStoreActive(store.id, !store.is_active);
      await load();
      Alert.alert(
        updated.is_active ? 'Store activated' : 'Store deactivated',
        updated.is_active
          ? `"${updated.name}" now appears in the Store Locator.`
          : `"${updated.name}" no longer appears in the Store Locator.`
      );
    } catch (err) {
      Alert.alert('Could not change status', extractErrorMessage(err, 'Please try again'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (store: AdminStore) => {
    Alert.alert(
      'Delete store',
      `Delete "${store.name}"?\n\nIf any order was delivered from this store, it is hidden ` +
        'instead of erased so those orders keep their store details.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(store.id);
            try {
              const outcome = await superAdminApi.deleteStore(store.id);
              await load();
              Alert.alert('Store removed', outcome.message);
            } catch (err) {
              Alert.alert('Could not delete', extractErrorMessage(err, 'Please try again'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const field = (
    label: string,
    key: keyof FormState,
    options: { required?: boolean; keyboardType?: any; placeholder?: string } = {}
  ) => (
    <View style={styles.fieldGroup} key={key}>
      <Text style={styles.fieldLabel}>
        {label}
        {options.required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        style={styles.input}
        value={String(form[key])}
        onChangeText={(value) => setForm((current) => ({ ...current, [key]: value }))}
        placeholder={options.placeholder}
        placeholderTextColor={COLORS.TextSecondary}
        keyboardType={options.keyboardType}
        autoCapitalize={key === 'email' ? 'none' : 'sentences'}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Store Management</Text>
          <Text style={styles.headerSubtitle}>
            Stores shown here drive the customer Store Locator
          </Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={openAdd}>
          <Ionicons name="add" size={20} color={COLORS.Surface} />
          <Text style={styles.addButtonText}>Add Store</Text>
        </TouchableOpacity>
      </View>

      {status === 'loading' ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={COLORS.Primary} />
          <Text style={styles.centreText}>Loading stores…</Text>
        </View>
      ) : status === 'error' ? (
        <View style={styles.centre}>
          <Ionicons name="alert-circle-outline" size={32} color={COLORS.Error} />
          <Text style={styles.centreText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : stores.length === 0 ? (
        <View style={styles.centre}>
          <Ionicons name="storefront-outline" size={32} color={COLORS.TextSecondary} />
          <Text style={styles.centreText}>
            No stores yet. Add one and it appears in the Store Locator straight away.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {stores.map((store) => (
            <View key={store.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.storeName}>{store.name}</Text>
                <View style={[styles.badge, store.is_active ? styles.badgeOn : styles.badgeOff]}>
                  <Text style={styles.badgeText}>{store.is_active ? 'ACTIVE' : 'INACTIVE'}</Text>
                </View>
              </View>

              {store.address ? <Text style={styles.cardLine}>{store.address}</Text> : null}
              <Text style={styles.cardLine}>
                {[store.city, store.district, store.state, store.pincode].filter(Boolean).join(', ')}
              </Text>
              {store.contact_number ? (
                <Text style={styles.cardLine}>📞 {store.contact_number}</Text>
              ) : null}
              {store.email ? <Text style={styles.cardLine}>✉️ {store.email}</Text> : null}
              {store.opening_time && store.closing_time ? (
                <Text style={styles.cardLine}>
                  🕘 {toFormTime(store.opening_time)} – {toFormTime(store.closing_time)}
                </Text>
              ) : null}
              <Text style={styles.cardCoords}>
                {store.latitude}, {store.longitude}
              </Text>

              <View style={styles.cardActions}>
                {busyId === store.id ? (
                  <ActivityIndicator size="small" color={COLORS.Primary} />
                ) : (
                  <>
                    <TouchableOpacity style={styles.action} onPress={() => openEdit(store)}>
                      <Ionicons name="create-outline" size={16} color={COLORS.Primary} />
                      <Text style={styles.actionText}>Edit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.action} onPress={() => toggleActive(store)}>
                      <Ionicons
                        name={store.is_active ? 'eye-off-outline' : 'eye-outline'}
                        size={16}
                        color={COLORS.Primary}
                      />
                      <Text style={styles.actionText}>
                        {store.is_active ? 'Deactivate' : 'Activate'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.action} onPress={() => confirmDelete(store)}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.Error} />
                      <Text style={[styles.actionText, { color: COLORS.Error }]}>Delete</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={formOpen} animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{editing ? 'Edit Store' : 'Add Store'}</Text>
            <TouchableOpacity onPress={() => setFormOpen(false)}>
              <Ionicons name="close" size={26} color={COLORS.Surface} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView contentContainerStyle={styles.form}>
              {field('Store name', 'name', { required: true, placeholder: 'Swachham Dapoli' })}
              {field('Address', 'address', { required: true, placeholder: 'Dapoli Camp, Dapoli' })}
              {field('City', 'city', { required: true, placeholder: 'Dapoli' })}
              {field('District', 'district', { placeholder: 'Ratnagiri' })}
              {field('State', 'state', { placeholder: 'Maharashtra' })}
              {field('Pincode', 'pincode', { keyboardType: 'number-pad', placeholder: '415712' })}
              {field('Contact number', 'contact_number', {
                required: true,
                keyboardType: 'phone-pad',
                placeholder: '9876543210',
              })}
              {field('Email', 'email', {
                keyboardType: 'email-address',
                placeholder: 'store@swachham.co.in',
              })}
              {field('Latitude', 'latitude', { required: true, keyboardType: 'numbers-and-punctuation', placeholder: '17.7590000' })}
              {field('Longitude', 'longitude', { required: true, keyboardType: 'numbers-and-punctuation', placeholder: '73.1890000' })}
              {field('Opening time', 'opening_time', { placeholder: '09:00' })}
              {field('Closing time', 'closing_time', { placeholder: '20:00' })}

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Active</Text>
                  <Text style={styles.switchHint}>
                    Only active stores appear in the customer Store Locator.
                  </Text>
                </View>
                <Switch
                  value={form.is_active}
                  onValueChange={(value) => setForm((c) => ({ ...c, is_active: value }))}
                  trackColor={{ true: COLORS.Primary, false: COLORS.TextSecondary }}
                />
              </View>

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={COLORS.Surface} />
                ) : (
                  <Text style={styles.saveText}>{editing ? 'Save changes' : 'Add store'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    borderBottomLeftRadius: BORDER_RADIUS.lg,
    borderBottomRightRadius: BORDER_RADIUS.lg,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
  headerSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Surface,
    opacity: 0.9,
    marginTop: 2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.PrimaryDark,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  addButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Surface,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  centreText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  retryText: { color: COLORS.Surface, fontWeight: '600', fontFamily: TYPOGRAPHY.fontFamily },
  list: { padding: SPACING.md, gap: SPACING.md },
  card: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.light,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.xs },
  storeName: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  badge: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: BORDER_RADIUS.sm },
  badgeOn: { backgroundColor: COLORS.Primary },
  badgeOff: { backgroundColor: COLORS.TextSecondary },
  badgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.Surface,
  },
  cardLine: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextPrimary,
    marginBottom: 2,
  },
  cardCoords: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: SPACING.xs,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.Background,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  actionText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.Primary,
  },
  form: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  fieldGroup: { marginBottom: SPACING.md },
  fieldLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.xs,
  },
  required: { color: COLORS.Error },
  input: {
    backgroundColor: COLORS.Surface,
    borderWidth: 1,
    borderColor: COLORS.Background,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  switchHint: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  saveButton: {
    height: 52,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
});

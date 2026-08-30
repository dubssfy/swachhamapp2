import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import addressApi from '../../services/addressApi';
import { detectCurrentAddress } from '../../services/currentLocation';

export default function AddAddressScreen({ navigation }: any) {
  const [form, setForm] = useState({
    address_label: '', full_address: '', house_flat: '', area: '', city: '', state: '', pincode: '',
  });
  const [loading, setLoading] = useState(false);
  /**
   * The detected fix, held beside the text.
   *
   * The delivery charge is measured from these, so they are saved WITH the
   * address rather than re-derived later. Null until the button is used —
   * a typed address has no coordinates, which is what it has always been.
   */
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');

  const useCurrentLocation = async () => {
    if (locating) return;
    setLocating(true);
    setLocationNote('');
    const result = await detectCurrentAddress();
    if (!result.ok) {
      // Permission refused or no fix: say so and leave every field alone, so
      // the manual entry below is exactly as it was.
      setLocationNote(result.message);
      setLocating(false);
      return;
    }
    const found = result.address;
    /*
     * ONLY EMPTY FIELDS ARE FILLED. Anything already typed is the customer's,
     * and a detected value is a worse answer than the one they gave.
     */
    setForm((current) => ({
      ...current,
      full_address: current.full_address || found.full_address,
      area: current.area || found.area,
      city: current.city || found.city,
      state: current.state || found.state,
      pincode: current.pincode || found.pincode,
    }));
    setCoords({ latitude: found.latitude, longitude: found.longitude });
    setLocationNote(
      found.full_address || found.city
        ? 'Location detected. Check the address below and edit anything that is wrong.'
        : 'Location captured, but we could not name the street. Please type the address below.'
    );
    setLocating(false);
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await addressApi.addAddress({ ...form, ...(coords ?? {}), is_default: false });
      navigation.goBack();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Add Address</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Above the fields, because it is the shortcut PAST them. Typing
            below is untouched and remains the way to enter anything the
            phone gets wrong. */}
        <TouchableOpacity
          style={styles.locateButton}
          onPress={useCurrentLocation}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel="Use my current location to fill in this address"
          accessibilityState={{ disabled: locating }}
        >
          {locating
            ? <ActivityIndicator size="small" color={COLORS.Primary} />
            : <Ionicons name="locate-outline" size={20} color={COLORS.Primary} />}
          <Text style={styles.locateText}>
            {locating ? 'Finding you…' : 'Use My Current Location'}
          </Text>
        </TouchableOpacity>

        {!!locationNote && <Text style={styles.locateNote}>{locationNote}</Text>}

        <TextInput style={styles.input} placeholder="Label (e.g. Home, Work)" value={form.address_label} onChangeText={(text) => setForm({ ...form, address_label: text })} />
        <TextInput style={styles.input} placeholder="Full Address" value={form.full_address} onChangeText={(text) => setForm({ ...form, full_address: text })} />
        <TextInput style={styles.input} placeholder="House / Flat (Optional)" value={form.house_flat} onChangeText={(text) => setForm({ ...form, house_flat: text })} />
        <TextInput style={styles.input} placeholder="Area (Optional)" value={form.area} onChangeText={(text) => setForm({ ...form, area: text })} />
        <TextInput style={styles.input} placeholder="City" value={form.city} onChangeText={(text) => setForm({ ...form, city: text })} />
        <TextInput style={styles.input} placeholder="State" value={form.state} onChangeText={(text) => setForm({ ...form, state: text })} />
        <TextInput style={styles.input} placeholder="Pincode" keyboardType="numeric" value={form.pincode} onChangeText={(text) => setForm({ ...form, pincode: text })} />
        
        <TouchableOpacity style={[styles.button, loading && styles.disabled]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={COLORS.Surface} /> : <Text style={styles.buttonText}>Save Address</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  header: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.Surface, elevation: 2 },
  backButton: { marginRight: SPACING.md },
  title: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold', color: COLORS.TextPrimary },
  content: { padding: SPACING.lg, gap: SPACING.md },
  input: { backgroundColor: COLORS.Surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.sm, borderWidth: 1, borderColor: COLORS.Border, fontSize: TYPOGRAPHY.sizes.base },
  locateButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.Surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.Primary,
  },
  locateText: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold', color: COLORS.Primary,
  },
  locateNote: {
    fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary, marginTop: -SPACING.xs,
  },
  button: { backgroundColor: COLORS.Primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginTop: SPACING.lg },
  disabled: { opacity: 0.7 },
  buttonText: { color: COLORS.Surface, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold' }
});

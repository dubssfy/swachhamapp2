import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import addressApi from '../../services/addressApi';

export default function EditAddressScreen({ route, navigation }: any) {
  const { addressId } = route.params;
  const [form, setForm] = useState({
    address_label: '', full_address: '', house_flat: '', area: '', city: '', state: '', pincode: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAddress();
  }, [addressId]);

  const fetchAddress = async () => {
    try {
      // The API exposes the collection, not a single address by id.
      const res = await addressApi.getAddresses();
      const address = res.data.find((item) => String(item.id) === String(addressId));
      if (!address) return;
      setForm({
        address_label: address.address_label || '',
        full_address: address.full_address || '',
        house_flat: address.house_flat || '',
        area: address.area || '',
        city: address.city || '',
        state: address.state || '',
        pincode: address.pincode || '',
      });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await addressApi.updateAddress(addressId, form);
      navigation.goBack();
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      setSaving(true);
      await addressApi.deleteAddress(addressId);
      navigation.goBack();
    } catch (error) {
      console.error(error);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.Primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Address</Text>
        <TouchableOpacity onPress={handleDelete} style={{ marginLeft: 'auto' }}>
          <Ionicons name="trash-outline" size={24} color="red" />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput style={styles.input} placeholder="Label (e.g. Home, Work)" value={form.address_label} onChangeText={(text) => setForm({ ...form, address_label: text })} />
        <TextInput style={styles.input} placeholder="Full Address" value={form.full_address} onChangeText={(text) => setForm({ ...form, full_address: text })} />
        <TextInput style={styles.input} placeholder="House / Flat (Optional)" value={form.house_flat} onChangeText={(text) => setForm({ ...form, house_flat: text })} />
        <TextInput style={styles.input} placeholder="Area (Optional)" value={form.area} onChangeText={(text) => setForm({ ...form, area: text })} />
        <TextInput style={styles.input} placeholder="City" value={form.city} onChangeText={(text) => setForm({ ...form, city: text })} />
        <TextInput style={styles.input} placeholder="State" value={form.state} onChangeText={(text) => setForm({ ...form, state: text })} />
        <TextInput style={styles.input} placeholder="Pincode" keyboardType="numeric" value={form.pincode} onChangeText={(text) => setForm({ ...form, pincode: text })} />
        
        <TouchableOpacity style={[styles.button, saving && styles.disabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={COLORS.Surface} /> : <Text style={styles.buttonText}>Save Changes</Text>}
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
  button: { backgroundColor: COLORS.Primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginTop: SPACING.lg },
  disabled: { opacity: 0.7 },
  buttonText: { color: COLORS.Surface, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold' }
});

import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import addressApi from '../../services/addressApi';

export default function AddAddressScreen({ navigation }: any) {
  const [form, setForm] = useState({
    address_label: '', full_address: '', house_flat: '', area: '', city: '', state: '', pincode: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    try {
      setLoading(true);
      await addressApi.addAddress({ ...form, is_default: false });
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
  button: { backgroundColor: COLORS.Primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginTop: SPACING.lg },
  disabled: { opacity: 0.7 },
  buttonText: { color: COLORS.Surface, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold' }
});

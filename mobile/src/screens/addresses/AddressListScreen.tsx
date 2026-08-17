import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import addressApi, { AddressData } from '../../services/addressApi';

export default function AddressListScreen({ navigation }: any) {
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchAddresses();
    });
    return unsubscribe;
  }, [navigation]);

  const fetchAddresses = async () => {
    try {
      setLoading(true);
      const res = await addressApi.getAddresses();
      setAddresses(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: AddressData }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.tag}>{item.address_label}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('EditAddress', { addressId: item.id })}>
          <Ionicons name="create-outline" size={20} color={COLORS.Primary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.addressText}>{item.full_address}</Text>
      {item.area ? <Text style={styles.addressText}>{item.area}</Text> : null}
      <Text style={styles.addressText}>{item.city}, {item.state} {item.pincode}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>My Addresses</Text>
      </View>
      
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.Primary} style={styles.loader} />
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No addresses found.</Text>}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('AddAddress')}>
        <Ionicons name="add" size={30} color={COLORS.Surface} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  header: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.Surface, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  backButton: { marginRight: SPACING.md },
  title: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold', color: COLORS.TextPrimary },
  list: { padding: SPACING.lg, paddingBottom: 100 },
  loader: { marginTop: SPACING.xxl },
  card: { backgroundColor: COLORS.Surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  tag: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: 'bold', color: COLORS.Primary, backgroundColor: COLORS.Background, paddingHorizontal: 8, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm },
  addressText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextPrimary, marginBottom: 2 },
  emptyText: { textAlign: 'center', color: COLORS.TextSecondary, marginTop: SPACING.xl },
  fab: { position: 'absolute', bottom: SPACING.xl, right: SPACING.xl, width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.Primary, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }
});

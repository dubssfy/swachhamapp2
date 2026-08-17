import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import businessApi from '../../services/businessApi';
import { Business } from '../../types';

export default function HomeScreen({ navigation }: any) {
  const { user } = useAuthStore();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    try {
      setLoading(true);
      const res = await businessApi.getBusinesses();
      setBusinesses((res.data as any).businesses || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const renderBusiness = ({ item }: { item: Business }) => (
    <TouchableOpacity 
      style={styles.card}
      onPress={() => navigation.navigate('BusinessDetails', { businessId: item.id })}
    >
      <Text style={styles.businessName}>{(item as any).name || item.businessName}</Text>
      <Text style={styles.businessAddress}>{item.city}, {item.state}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.greeting}>Welcome, {user?.name || 'User'}!</Text>
      
      <Text style={styles.sectionTitle}>Active Laundry Services</Text>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.Primary} />
      ) : (
        <FlatList
          data={businesses}
          keyExtractor={(item) => item.id}
          renderItem={renderBusiness}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No businesses found.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background, padding: SPACING.lg },
  greeting: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xl, fontWeight: 'bold', color: COLORS.TextPrimary, marginBottom: SPACING.md },
  sectionTitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: '600', color: COLORS.TextPrimary, marginBottom: SPACING.md },
  list: { paddingBottom: SPACING.xxl },
  card: { backgroundColor: COLORS.Surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  businessName: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base, fontWeight: 'bold', color: COLORS.TextPrimary },
  businessAddress: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextSecondary, marginTop: 4 },
  emptyText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base, color: COLORS.TextSecondary, textAlign: 'center', marginTop: SPACING.xl }
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import businessApi, { BusinessData } from '../../services/businessApi';

export default function BusinessListScreen({ navigation }: any) {
  const [businesses, setBusinesses] = useState<BusinessData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    try {
      setLoading(true);
      const res = await businessApi.getBusinesses();
      setBusinesses(res.data.businesses);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: BusinessData }) => (
    <TouchableOpacity 
      style={styles.card}
      onPress={() => navigation.navigate('BusinessDetails', { businessId: item.id })}
    >
      <Text style={styles.businessName}>{item.name}</Text>
      <Text style={styles.businessAddress}>{item.address}, {item.city}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Partner Businesses</Text>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.Primary} />
      ) : (
        <FlatList
          data={businesses}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No businesses available.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background, padding: SPACING.lg },
  title: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xl, fontWeight: 'bold', color: COLORS.TextPrimary, marginBottom: SPACING.md },
  list: { paddingBottom: SPACING.xxl },
  card: { backgroundColor: COLORS.Surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md },
  businessName: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base, fontWeight: 'bold', color: COLORS.TextPrimary },
  businessAddress: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextSecondary, marginTop: 4 },
  emptyText: { textAlign: 'center', color: COLORS.TextSecondary, marginTop: SPACING.xl }
});

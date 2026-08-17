import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import businessApi, { BusinessData } from '../../services/businessApi';

export default function BusinessDetailsScreen({ route, navigation }: any) {
  const { businessId } = route.params;
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBusinessDetails();
  }, [businessId]);

  const fetchBusinessDetails = async () => {
    try {
      setLoading(true);
      const res = await businessApi.getBusiness(businessId);
      setBusiness(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.Primary} />
      </SafeAreaView>
    );
  }

  if (!business) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Business not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.TextPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Details</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.businessName}>{business.name}</Text>
        <Text style={styles.businessAddress}>{business.address}</Text>
        <Text style={styles.businessAddress}>{business.city}, {business.state} {business.pincode}</Text>
        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>Contact Info</Text>
        <Text style={styles.infoText}>Type: {business.business_type}</Text>
        <Text style={styles.infoText}>Phone: {business.phone_number || '-'}</Text>
        <Text style={styles.infoText}>Email: {business.email || '-'}</Text>
        {business.description && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.infoText}>{business.description}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.Surface, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  backButton: { marginRight: SPACING.md },
  title: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold', color: COLORS.TextPrimary },
  content: { padding: SPACING.lg },
  businessName: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xl, fontWeight: 'bold', color: COLORS.TextPrimary, marginBottom: SPACING.xs },
  businessAddress: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextSecondary },
  divider: { height: 1, backgroundColor: COLORS.Border, marginVertical: SPACING.lg },
  sectionTitle: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base, fontWeight: 'bold', color: COLORS.TextPrimary, marginBottom: SPACING.sm },
  infoText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, color: COLORS.TextPrimary, marginBottom: SPACING.xs },
  errorText: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.base, color: COLORS.TextSecondary }
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Image,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import SwachhamChatLauncher from '../../components/chat/SwachhamChatLauncher';
import { useAuthStore } from '../../store/authStore';
import businessApi from '../../services/businessApi';
import businessOrderApi from '../../services/businessOrderApi';
import serviceApi from '../../services/serviceApi';
import { extractErrorMessage } from '../../services/api';
import { Business, Service } from '../../types';

export default function HomeScreen({ navigation }: any) {
  const { user } = useAuthStore();
  const [profile, setProfile] = useState<any>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);

  useEffect(() => {
    fetchBusinesses();
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await businessOrderApi.getProfile();
      if (res?.data) {
        setProfile(res.data);
      }
    } catch {
      // Ignored for non-business or offline
    }
  };

  const fetchBusinesses = async () => {
    try {
      setLoadingBusinesses(true);
      const res = await businessApi.getBusinesses();
      setBusinesses((res.data as any).businesses || []);
    } catch (error) {
      console.error('Error fetching businesses:', error);
    } finally {
      setLoadingBusinesses(false);
    }
  };

  const handleSelectLaundryType = (type: 'hotel' | 'guest', label: string) => {
    navigation.navigate('OrderType', {
      laundryType: type,
      laundryLabel: label,
    });
  };

  const handleSelectService = (item: Service) => {
    // Navigate using existing navigation flow
    if (item.category_id || item.categoryId) {
      navigation.navigate('ServiceCategory', {
        categoryId: item.category_id || item.categoryId,
        name: item.category_name || item.categoryName || item.name,
        serviceId: item.id,
      });
    } else {
      // If no category ID, navigate with service name
      navigation.navigate('ServiceCategory', {
        name: item.name,
        serviceId: item.id,
      });
    }
  };

  const renderBusiness = ({ item }: { item: Business }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('BusinessDetails', { businessId: item.id })}
      activeOpacity={0.7}
    >
      <Text style={styles.businessName}>{(item as any).name || item.businessName}</Text>
      <Text style={styles.businessAddress}>{item.city}, {item.state}</Text>
    </TouchableOpacity>
  );

  const formatPrice = (item: Service) => {
    const priceVal = item.price ?? item.customer_price ?? item.basePrice;
    if (priceVal != null && Number(priceVal) > 0) {
      return `₹${priceVal} / ${item.unit || 'piece'}`;
    }
    return 'Price on request';
  };

  const renderServiceResult = ({ item }: { item: Service }) => (
    <TouchableOpacity
      style={styles.serviceResultCard}
      onPress={() => handleSelectService(item)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.category_name || 'Service'}`}
    >
      <View style={styles.serviceThumb}>
        {item.image_url || item.imageUrl ? (
          <Image
            source={{ uri: item.image_url || item.imageUrl }}
            style={styles.serviceThumbImage}
            resizeMode="contain"
          />
        ) : (
          <Ionicons name="shirt-outline" size={24} color={COLORS.Primary} />
        )}
      </View>

      <View style={styles.serviceContent}>
        <Text style={styles.serviceName} numberOfLines={1}>
          {item.name}
        </Text>
        
        {item.category_name ? (
          <Text style={styles.serviceCategory} numberOfLines={1}>
            {item.category_name}
          </Text>
        ) : null}

        {item.description ? (
          <Text style={styles.serviceDescription} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.serviceFooterRow}>
          <Text style={styles.servicePrice}>{formatPrice(item)}</Text>
          
          {item.service_types && item.service_types.length > 0 ? (
            <View style={styles.serviceTypesList}>
              {item.service_types.map((st) => (
                <View key={st} style={styles.serviceTypeBadge}>
                  <Text style={styles.serviceTypeBadgeText}>
                    {st.replace(/_/g, ' ')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={20} color={COLORS.TextSecondary} style={styles.chevron} />
    </TouchableOpacity>
  );

  const establishmentName =
    profile?.business_name ||
    profile?.establishment_name ||
    user?.establishment_name ||
    user?.business_name ||
    user?.establishmentName ||
    user?.businessName ||
    'Swachham';

  const userName = user?.name || profile?.contact_person_name || 'User';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Full-width Top Navigator Logo Banner with highlighted bottom lines */}
      <View style={styles.topLogoBannerWrap}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.topLogoBanner}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>

      {/* Establishment / Business Name on Line 1 & User Name on Line 2 with Divider */}
      <View style={styles.header}>
        <Text style={styles.establishmentName} numberOfLines={1}>
          {establishmentName}
        </Text>
        <Text style={styles.userName} numberOfLines={1}>
          {userName}
        </Text>
        <View style={styles.userDivider} />
      </View>

      {/* Laundry Type Selection Section */}
      <View style={styles.defaultContent}>
        <View style={styles.laundryTypeSection}>
          <View style={styles.headingBadgeWrap}>
            <View style={styles.headingBadge}>
              <Text style={styles.sectionHeading}>LAUNDRY TYPE</Text>
            </View>
          </View>

          <View style={styles.laundryCardsContainer}>
            {/* Hotel Laundry Card */}
            <TouchableOpacity
              style={styles.laundryCard}
              onPress={() => handleSelectLaundryType('hotel', 'Hotel Laundry')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Hotel Laundry"
            >
              <View style={styles.cardHeader}>
                <View style={styles.iconCircle}>
                  <Ionicons name="business" size={26} color="#ffbd4a" />
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>HOTEL LAUNDRY</Text>
                  <Text style={styles.cardSubtitle}>Linen & property-owned items</Text>
                </View>
                <Ionicons name="chevron-forward-circle" size={28} color="#ffbd4a" />
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardFeatures}>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                  <Text style={styles.featureText}>Hotel linen, towels & bedding</Text>
                </View>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                  <Text style={styles.featureText}>Property & uniform management</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Guest Laundry Card */}
            <TouchableOpacity
              style={styles.laundryCard}
              onPress={() => handleSelectLaundryType('guest', 'Guest Laundry')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Guest Laundry"
            >
              <View style={styles.cardHeader}>
                <View style={styles.iconCircle}>
                  <Ionicons name="person" size={26} color="#ffbd4a" />
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>GUEST LAUNDRY</Text>
                  <Text style={styles.cardSubtitle}>Items belonging to your guests</Text>
                </View>
                <Ionicons name="chevron-forward-circle" size={28} color="#ffbd4a" />
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardFeatures}>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                  <Text style={styles.featureText}>Personal guest garment care</Text>
                </View>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                  <Text style={styles.featureText}>Express room delivery available</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Swachham AI assistant floating launcher */}
      <SwachhamChatLauncher />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.Background,
  },
  topLogoBannerWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingTop: SPACING.xs,
  },
  topLogoBanner: {
    width: '100%',
    height: 70,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xs,
  },
  establishmentName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  userName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  userDivider: {
    height: 1,
    backgroundColor: COLORS.Border,
    marginTop: SPACING.sm,
    width: '100%',
  },
  searchWrap: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  searchIcon: {
    marginRight: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
    height: '100%',
  },
  resultsArea: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
  },
  resultsList: {
    paddingBottom: SPACING.xxl,
  },
  resultsCount: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextSecondary,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
  serviceResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  serviceThumb: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  serviceThumbImage: {
    width: 40,
    height: 40,
  },
  serviceContent: {
    flex: 1,
  },
  serviceName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  serviceCategory: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: '600',
    color: COLORS.Primary,
    marginTop: 2,
  },
  serviceDescription: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 2,
  },
  serviceFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    flexWrap: 'wrap',
    gap: 4,
  },
  servicePrice: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  serviceTypesList: {
    flexDirection: 'row',
    gap: 4,
  },
  serviceTypeBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.xs,
  },
  serviceTypeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.Primary,
    textTransform: 'capitalize',
  },
  chevron: {
    marginLeft: SPACING.xs,
  },
  defaultContent: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
  },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '600',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.md,
  },
  list: {
    paddingBottom: SPACING.xxl,
  },
  card: {
    backgroundColor: COLORS.Surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.Border,
    ...SHADOWS.light,
  },
  businessName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
  },
  businessAddress: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginTop: 4,
  },
  emptyText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: SPACING.xl,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
  },
  loadingText: {
    marginTop: SPACING.sm,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  emptyTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.TextPrimary,
    marginTop: SPACING.sm,
  },
  emptySubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: SPACING.lg,
  },
  searchErrorText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.Error,
    textAlign: 'center',
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  retryButton: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.Primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  laundryTypeSection: {
    marginBottom: SPACING.lg,
  },
  headingBadgeWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  headingBadge: {
    backgroundColor: '#ffbd4a',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.light,
  },
  sectionHeading: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  laundryCardsContainer: {
    gap: SPACING.lg,
  },
  laundryCard: {
    backgroundColor: '#3d6f73',
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2.5,
    borderColor: '#ffbd4a',
    padding: SPACING.lg,
    ...SHADOWS.medium,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  cardSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: '#D8F3DC',
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginVertical: SPACING.md,
  },
  cardFeatures: {
    gap: 6,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: '#FFFFFF',
  },
});



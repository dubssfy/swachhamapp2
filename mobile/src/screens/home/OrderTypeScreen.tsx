import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import {
  useBusinessOrderStore,
  LaundryType,
  OrderType,
  QUICK_ORDER_MULTIPLIER_FALLBACK,
} from '../../store/businessOrderStore';
import businessOrderApi from '../../services/businessOrderApi';

export default function OrderTypeScreen({ navigation, route }: any) {
  const routeLaundryType = (route?.params?.laundryType as LaundryType) || 'hotel';
  const routeLaundryLabel =
    route?.params?.laundryLabel ||
    (routeLaundryType === 'guest' ? 'Guest Laundry' : 'Hotel Laundry');

  const {
    saveLaundryType,
    saveOrderType,
    laundryType: storeLaundryType,
    orderType: storeOrderType,
  } = useBusinessOrderStore();

  const [selectedLaundryType, setSelectedLaundryType] = useState<LaundryType>(
    routeLaundryType || storeLaundryType || 'hotel'
  );
  const [selectedOrderType, setSelectedOrderType] = useState<OrderType>(
    storeOrderType || 'standard'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quickMultiplier, setQuickMultiplier] = useState(QUICK_ORDER_MULTIPLIER_FALLBACK);

  useEffect(() => {
    if (routeLaundryType) {
      setSelectedLaundryType(routeLaundryType);
      saveLaundryType(routeLaundryType).catch(() => {});
    }
  }, [routeLaundryType, saveLaundryType]);

  // Read the real Quick Order multiplier from the server
  useEffect(() => {
    businessOrderApi
      .getLaundryServices()
      .then((response) => {
        const val = response?.data?.quickOrderMultiplier;
        if (typeof val === 'number' && val > 1) {
          setQuickMultiplier(val);
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectOrderType = async (type: OrderType) => {
    setSelectedOrderType(type);

    if (type === 'quick') {
      Alert.alert(
        'Quick Order',
        `Quick Order is charged at ${quickMultiplier}x standard rate for priority processing.\n\nContinue with Quick Order?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Continue (${quickMultiplier}x)`,
            onPress: () => proceedWithOrderType('quick'),
          },
        ]
      );
    } else {
      proceedWithOrderType('standard');
    }
  };

  const proceedWithOrderType = async (type: OrderType) => {
    try {
      setIsSubmitting(true);
      await saveLaundryType(selectedLaundryType);
      await saveOrderType(type);

      // Navigate to the existing catalogue / order flow
      navigation.navigate('BusinessCategoriesScreen', {
        laundryType: selectedLaundryType,
        orderType: type,
      });
    } catch (err) {
      console.warn('Could not save order context to server, proceeding locally:', err);
      // Even if offline/unauthenticated, navigate forward with state in route params
      navigation.navigate('BusinessCategoriesScreen', {
        laundryType: selectedLaundryType,
        orderType: type,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top Logo Banner */}
      <View style={styles.topLogoWrap}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.topLogo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>

      {/* Header with Bordered Back Button */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to Laundry Type"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.PrimaryDark} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Type</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Selected Laundry Type Summary Badge */}
        <View style={styles.selectionBadgeWrap}>
          <View style={styles.selectionBadge}>
            <Ionicons
              name={selectedLaundryType === 'guest' ? 'person' : 'business'}
              size={16}
              color={COLORS.Primary}
            />
            <Text style={styles.selectionBadgeText}>
              Selected: <Text style={styles.selectionBadgeBold}>{routeLaundryLabel}</Text>
            </Text>
          </View>
        </View>

        <Text style={styles.instructionTitle}>Choose Your Order Type</Text>
        <Text style={styles.instructionSubtitle}>
          Select how quickly you need your laundry processed and delivered
        </Text>

        {/* ORDER TYPE CARDS: ONLY Standard Order and Quick Order (NO Priority Turnaround) */}
        <View style={styles.cardsContainer}>
          {/* 1. STANDARD ORDER */}
          <TouchableOpacity
            style={[
              styles.card,
              selectedOrderType === 'standard' && styles.cardActive,
            ]}
            onPress={() => handleSelectOrderType('standard')}
            activeOpacity={0.85}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Standard Order"
          >
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}>
                <Ionicons name="calendar-outline" size={26} color="#FFFFFF" />
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={styles.cardTitle}>STANDARD ORDER</Text>
                <Text style={styles.cardRateTag}>Standard Turnaround · Regular Rate</Text>
              </View>
              <Ionicons
                name={selectedOrderType === 'standard' ? 'checkmark-circle' : 'chevron-forward-circle-outline'}
                size={28}
                color="#ffbd4a"
              />
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.cardFeatures}>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                <Text style={styles.featureText}>Normal scheduled delivery</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                <Text style={styles.featureText}>Best value for regular laundry</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* 2. QUICK ORDER */}
          <TouchableOpacity
            style={[
              styles.card,
              selectedOrderType === 'quick' && styles.cardActive,
            ]}
            onPress={() => handleSelectOrderType('quick')}
            activeOpacity={0.85}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Quick Order"
          >
            <View style={styles.cardHeader}>
              <View style={styles.iconCircle}>
                <Ionicons name="flash" size={26} color="#ffbd4a" />
              </View>
              <View style={styles.cardHeaderText}>
                <View style={styles.titleRow}>
                  <Text style={styles.cardTitle}>QUICK ORDER</Text>
                  <View style={styles.surchargeBadge}>
                    <Text style={styles.surchargeBadgeText}>{quickMultiplier}x RATE</Text>
                  </View>
                </View>
                <Text style={styles.cardRateTag}>Priority Turnaround · Express Processing</Text>
              </View>
              <Ionicons
                name={selectedOrderType === 'quick' ? 'checkmark-circle' : 'chevron-forward-circle-outline'}
                size={28}
                color="#ffbd4a"
              />
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.cardFeatures}>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                <Text style={styles.featureText}>Express queue priority</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark" size={16} color="#ffbd4a" />
                <Text style={styles.featureText}>Fastest turnaround for urgent items</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {isSubmitting ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.Primary} />
            <Text style={styles.loadingText}>Updating order...</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.Background,
  },
  topLogoWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xs,
    backgroundColor: 'transparent',
  },
  topLogo: {
    width: '100%',
    height: 70,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.Surface,
    borderWidth: 1.5,
    borderColor: COLORS.Primary,
    ...SHADOWS.light,
  },
  backButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '700',
    color: COLORS.PrimaryDark,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  placeholder: {
    width: 76,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  selectionBadgeWrap: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
  },
  selectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    gap: 6,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  selectionBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  selectionBadgeBold: {
    fontWeight: '700',
    color: COLORS.Primary,
  },
  instructionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '700',
    color: COLORS.TextPrimary,
    marginBottom: 4,
  },
  instructionSubtitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
    marginBottom: SPACING.lg,
  },
  cardsContainer: {
    gap: SPACING.lg,
  },
  card: {
    backgroundColor: '#3d6f73',
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2.5,
    borderColor: '#ffbd4a',
    padding: SPACING.lg,
    ...SHADOWS.medium,
  },
  cardActive: {
    borderColor: '#ffbd4a',
    backgroundColor: '#2b5155',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  cardRateTag: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: '#D8F3DC',
    marginTop: 2,
  },
  surchargeBadge: {
    backgroundColor: '#ffbd4a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.xs,
  },
  surchargeBadgeText: {
    color: '#1B3B36',
    fontSize: 10,
    fontWeight: '800',
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
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
    gap: 8,
  },
  loadingText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
});

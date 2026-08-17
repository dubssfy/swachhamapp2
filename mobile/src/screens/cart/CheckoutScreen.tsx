import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { useCartStore } from '../../store/cartStore';

// Mock data matching the screenshot
const orderItems = [
  {
    id: '1',
    name: 'Shirt / T-shirt / Trouser / Jeans',
    originalPrice: 18.00,
    discountedPrice: 9.00,
    quantity: 1,
    category: 'Steam Iron Items'
  },
  {
    id: '2',
    name: 'Plain Top / Kurta / Kurti / Pyjama',
    originalPrice: 18.00,
    discountedPrice: 9.00,
    quantity: 1,
    category: 'Steam Iron Items'
  }
];

export default function CheckoutScreen({ navigation }: any) {
  // In a real app, use useCartStore() to get these values
  const totalEstimatedPay = 42.00;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.PrimaryDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Summary</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Step Indicator */}
        <View style={styles.stepIndicator}>
          <View style={[styles.stepBar, styles.stepBarActive]} />
          <View style={[styles.stepBar, styles.stepBarActive]} />
          <View style={[styles.stepBar, styles.stepBarActive]} />
        </View>

        {/* Free Delivery Banner */}
        <View style={styles.deliveryBanner}>
          <MaterialIcons name="local-shipping" size={20} color={COLORS.Surface} />
          <Text style={styles.deliveryBannerText}>
            Almost there — add <Text style={styles.boldText}>₹21.00</Text> to reach <Text style={styles.boldText}>₹39.00</Text> for a free delivery.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Order Items</Text>
        
        {/* Order Items List */}
        <View style={styles.itemsContainer}>
          <Text style={styles.categoryTitle}>Steam Iron Items</Text>
          
          {orderItems.map((item, index) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemIconContainer}>
                <Ionicons name="shirt-outline" size={24} color={COLORS.Primary} />
              </View>
              
              <View style={styles.itemDetails}>
                <Text style={styles.itemName}>{item.name}</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.originalPrice}>₹{item.originalPrice.toFixed(2)}</Text>
                  <Text style={styles.discountedPrice}>₹{item.discountedPrice.toFixed(2)}</Text>
                </View>
              </View>
              
              <View style={styles.quantityContainer}>
                <TouchableOpacity style={styles.quantityBtn}>
                  <MaterialIcons name="remove" size={16} color={COLORS.TextPrimary} />
                </TouchableOpacity>
                <Text style={styles.quantityText}>{item.quantity.toString().padStart(2, '0')}</Text>
                <TouchableOpacity style={[styles.quantityBtn, styles.quantityBtnAdd]}>
                  <MaterialIcons name="add" size={16} color={COLORS.Surface} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Schedule Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <MaterialIcons name="event" size={24} color={COLORS.PrimaryDark} style={styles.infoIcon} />
            <View>
              <Text style={styles.infoLabel}>Pickup scheduled for</Text>
              <Text style={styles.infoValue}>Thu, 16 Jul 2026, 10:00 AM - 11:00 AM</Text>
            </View>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <MaterialIcons name="event-available" size={24} color={COLORS.PrimaryDark} style={styles.infoIcon} />
            <View>
              <Text style={styles.infoLabel}>Delivery scheduled for</Text>
              <Text style={styles.infoValue}>Fri, 17 Jul 2026, 11:00 AM - 12:00 PM</Text>
            </View>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <MaterialIcons name="location-on" size={24} color={COLORS.PrimaryDark} style={styles.infoIcon} />
            <View>
              <Text style={styles.infoLabel}>Pickup Address</Text>
              <Text style={styles.infoValue}>201, 2, , , Manpada, Thane West, Thane, Maharashtra, India</Text>
            </View>
          </View>
        </View>
        
        {/* Padding for bottom bar */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Bottom Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.totalContainer}>
          <Text style={styles.totalLabel}>Total Estimated Pay</Text>
          <Text style={styles.totalValue}>₹{totalEstimatedPay.toFixed(2)}</Text>
        </View>
        <TouchableOpacity 
          style={styles.bookButton}
          onPress={() => console.log('Book Order')}
        >
          <Text style={styles.bookButtonText}>Book Order</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.Background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.Surface,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.Border,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  stepBar: {
    height: 4,
    flex: 1,
    backgroundColor: COLORS.Border,
    marginHorizontal: 2,
    borderRadius: 2,
  },
  stepBarActive: {
    backgroundColor: '#0EA5E9', // Light blue from screenshot
  },
  deliveryBanner: {
    backgroundColor: COLORS.Error, // Using red from screenshot
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xl,
  },
  deliveryBannerText: {
    color: COLORS.Surface,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginLeft: SPACING.sm,
    flex: 1,
  },
  boldText: {
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
    marginBottom: SPACING.md,
  },
  itemsContainer: {
    marginBottom: SPACING.xl,
  },
  categoryTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.PrimaryDark,
    marginBottom: SPACING.md,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  itemIconContainer: {
    width: 50,
    height: 50,
    backgroundColor: '#F0FDF4', // Very light green
    borderRadius: BORDER_RADIUS.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  itemDetails: {
    flex: 1,
  },
  itemName: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.PrimaryDark,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  originalPrice: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    textDecorationLine: 'line-through',
    marginRight: SPACING.sm,
  },
  discountedPrice: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: 'bold',
    color: '#0EA5E9', // Light blue from screenshot
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.Background,
    borderRadius: 20,
    padding: 2,
  },
  quantityBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityBtnAdd: {
    backgroundColor: COLORS.PrimaryDark,
  },
  quantityText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    marginHorizontal: SPACING.sm,
  },
  infoCard: {
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.light,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
  },
  infoIcon: {
    marginRight: SPACING.md,
    marginTop: 2,
  },
  infoLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.PrimaryDark,
    flexShrink: 1,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.Border,
    marginVertical: SPACING.sm,
    marginLeft: 40,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.Surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.Border,
    ...SHADOWS.medium,
  },
  totalContainer: {
    flex: 1,
  },
  totalLabel: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
  },
  totalValue: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
  },
  bookButton: {
    backgroundColor: COLORS.PrimaryLight, // Cyan/teal button from screenshot
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  bookButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.Surface,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { useCartStore } from '../../store/cartStore';

export default function CartScreen({ navigation }: any) {
  // In a real app, use useCartStore()
  const cartItems = []; 

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topLogoWrap}>
        <Image
          source={require('../../../assets/swachham-header-logo.png')}
          style={styles.topLogo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.Surface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Cart</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name="add-shopping-cart" size={48} color={COLORS.Surface} />
        </View>
        
        <Text style={styles.emptyTitle}>Add items to your cart</Text>
        
        <TouchableOpacity 
          style={styles.browseButton}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.browseButtonText}>Browse More</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.Surface,
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
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.lg,
    backgroundColor: COLORS.PrimaryLight, // Cyan/teal header from screenshot
  },
  backButton: {
    marginRight: SPACING.md,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.PrimaryLight, // Match the cyan/teal circle
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  emptyTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
    marginBottom: SPACING.xl,
  },
  browseButton: {
    backgroundColor: COLORS.PrimaryLight, // Cyan/teal button
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl * 2,
    borderRadius: BORDER_RADIUS.md,
    width: '80%',
    alignItems: 'center',
  },
  browseButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    color: COLORS.Surface,
  },
});

import React, { useCallback, useRef, useState } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
/* THE CUSTOMER PALETTE, imported under the name `COLORS`.
 *
 * #3d6173 and #ffbd4a. Aliased rather than renamed at every use so this
 * screen reads the same as the rest of the app, and so the green `COLORS`
 * -- which the business, sorter, rider and super-admin screens all import --
 * is left exactly as it is. See `CUSTOMER_COLORS` in constants/theme. */
import { CUSTOMER_COLORS as COLORS, TYPOGRAPHY } from '../../constants/theme';
import customerCartApi from '../../services/customerCartApi';
import { useCartFly } from '../../components/CartFlyOverlay';

/**
 * The cart button, with its live count.
 *
 * IT READS THE REAL CART. The badge is the sum of the quantities in
 * `GET /api/cart` — the same cart the Cart tab shows and the same one the
 * order is created from.
 *
 * REFETCHED ON FOCUS, so returning from adding an item shows the new count
 * without the screen having to know anything happened.
 *
 * NAVIGATES TO THE CART TAB, not to a pushed copy of it.
 */
export default function CartIconButton({
  navigation,
  color = '#3D6F73',
}: {
  navigation: any;
  color?: string;
}) {
  const [count, setCount] = useState(0);

  /*
   * WHERE THE BAG LANDS.
   *
   * The button reports its own position in window coordinates, so the
   * animation flies to the icon actually on screen rather than to an assumed
   * corner. Measured on layout, which is also when it settles after a rotation
   * or a change in the header above it.
   */
  const buttonRef = useRef<View>(null);
  const { setCartAnchor } = useCartFly();

  const measure = useCallback(() => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      if (typeof x === 'number' && typeof y === 'number') {
        setCartAnchor({ x: x + width / 2, y: y + height / 2 });
      }
    });
  }, [setCartAnchor]);

  const load = useCallback(async () => {
    try {
      const cart = await customerCartApi.getCart();

      setCount(
        cart.items.reduce(
          (sum, item) => sum + Number(item.quantity || 0),
          0
        )
      );
    } catch {
      // A cart that cannot be read shows no badge rather than a wrong one.
      setCount(0);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <TouchableOpacity
      ref={buttonRef}
      onLayout={measure}
      style={styles.button}
      onPress={() => navigation.navigate('Cart')}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? `Cart, ${count} items`
          : 'Cart, empty'
      }
      activeOpacity={0.8}
    >
      <Ionicons
        name="cart-outline"
        size={22}
        color={color}
      />

      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 7,
    borderRadius: 10,

    // Light shade of #3d6f73.
    backgroundColor: '#E7F1F1',

    // Soft teal border.
    borderWidth: 1,
    borderColor: '#B7D0D1',

    alignItems: 'center',
    justifyContent: 'center',

    // Subtle depth.
    shadowColor: '#3D6F73',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },

  badge: {
    position: 'absolute',
    top: -3,
    right: -4,

    minWidth: 18,
    height: 18,
    borderRadius: 9,

    paddingHorizontal: 4,

    // Main theme color.
    backgroundColor: '#3D6F73',

    // Keeps the badge visually separated from the button.
    borderWidth: 1.5,
    borderColor: '#FFFFFF',

    alignItems: 'center',
    justifyContent: 'center',
  },

  badgeText: {
    color: '#FFFFFF',
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '700',
  },
});

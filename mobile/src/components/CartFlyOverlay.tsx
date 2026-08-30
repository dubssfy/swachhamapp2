import React, {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { Animated, Dimensions, Easing, Image, StyleSheet, View } from 'react-native';

/**
 * THE ADD-TO-CART BAG.
 *
 * A bag springs from the Add to Cart button that was pressed, swells as it
 * travels to the middle of the screen, then shrinks away into the cart icon
 * at the top right.
 *
 * ============================================================
 * IT IS AN OVERLAY, NOT PART OF ANY SCREEN
 * ============================================================
 *
 * The bag is drawn in one absolutely-positioned layer mounted once, above the
 * whole app, with `pointerEvents="none"`. Two things follow, and both are
 * requirements rather than conveniences:
 *
 *   NOTHING SHIFTS. The bag is out of flow, so no list reflows and no button
 *   moves while it flies.
 *
 *   SHOPPING IS NOT BLOCKED. The layer ignores touches entirely, so the
 *   customer can carry on tapping through the catalogue mid-flight.
 *
 * ============================================================
 * IT STARTS AT THE BUTTON THAT WAS ACTUALLY PRESSED
 * ============================================================
 *
 * The caller measures its own button in window coordinates and passes that
 * point in, so the origin is the real button rather than an assumed one. Any
 * number of Add to Cart buttons therefore work, each flying from where it
 * sits, and rapid taps stack up: each press is its own flight with its own
 * animated value, removed from the list when it lands.
 */

/** How big the bag is at its normal size, in points. */
const BAG = 64;

/**
 * Start small, swell WELL past full size at the centre, shrink into the cart.
 *
 * `SCALE_CENTRE` is 3.6, from 2.8 (and 1.8 before that). The bag reaches
 * about 230pt on a 375pt-wide phone — roughly three-fifths of the screen —
 * so the zoom is the loudest part of the sequence, which is what was asked
 * for. It still clears the edges on the narrowest phone in use (320pt), which
 * is the ceiling on this value: past about 4.5 the bag would be clipped by
 * the screen rather than framed by it.
 *
 * `SCALE_START` is deliberately left alone. It is how the bag leaves the
 * button, not part of the centre zoom, and lowering it to exaggerate the
 * growth further would make the bag appear from nothing rather than out of
 * the button that was pressed. The 0.45 -> 3.6 climb is already eightfold.
 */
const SCALE_START = 0.45;
const SCALE_CENTRE = 3.6;
const SCALE_END = 0.3;

/**
 * ~2.5s in total, from ~2.0s (and ~0.9s originally).
 *
 * Slowed again on request, so each beat of the sequence has room: the bag
 * leaves the button, swells on its way to the centre, sits there at its
 * largest, then travels up into the cart.
 *
 * THE HOLD KEEPS TAKING THE LARGEST SHARE of each increase, because the bag
 * is now very large at the centre and the pause is what gives the eye time to
 * take that in. It costs nothing elsewhere — the overlay takes no touches, so
 * a longer flight never blocks the next tap and the customer can keep
 * shopping straight through it.
 *
 * This is past the point where the animation reads purely as feedback on the
 * tap; at two and a half seconds it is a deliberate flourish. That is the
 * intent here, but it is the reason not to push it further.
 */
const TO_CENTRE_MS = 950;
const HOLD_MS = 550;
const TO_CART_MS = 1000;

export interface Point {
  x: number;
  y: number;
}

interface Flight {
  id: number;
  from: Point;
  to: Point;
  progress: Animated.Value;
}

interface CartFlyApi {
  /**
   * Records where the cart icon is, in window coordinates, so the bag knows
   * where to land. Passing null clears it — a screen without a cart icon
   * falls back to the top-right corner.
   */
  setCartAnchor: (point: Point | null) => void;
  /** Sends a bag from `from` to the cart. Safe to call while one is running. */
  flyToCart: (from: Point) => void;
}

const CartFlyContext = createContext<CartFlyApi>({
  setCartAnchor: () => {},
  flyToCart: () => {},
});

/** The hook every Add to Cart button and the cart icon use. */
export function useCartFly(): CartFlyApi {
  return useContext(CartFlyContext);
}

export function CartFlyProvider({ children }: { children: React.ReactNode }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  /*
   * The anchor is a REF, not state. It is written by the cart icon's layout
   * pass and read only when a flight starts; holding it in state would
   * re-render the whole app underneath this provider every time a screen with
   * a cart icon mounted.
   */
  const anchor = useRef<Point | null>(null);
  const nextId = useRef(0);

  const setCartAnchor = useCallback((point: Point | null) => {
    anchor.current = point;
  }, []);

  const flyToCart = useCallback((from: Point) => {
    const window = Dimensions.get('window');
    // No cart icon on screen: the top-right corner is where it would be, and
    // is a better guess than refusing to animate.
    const to = anchor.current ?? { x: window.width - 32, y: 56 };

    const id = nextId.current++;
    const progress = new Animated.Value(0);
    setFlights((current) => [...current, { id, from, to, progress }]);

    Animated.sequence([
      // 0 -> 0.5: out to the centre, growing.
      Animated.timing(progress, {
        toValue: 0.5,
        duration: TO_CENTRE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // A beat at full size, so the grow reads as a moment rather than a blur.
      Animated.delay(HOLD_MS),
      // 0.5 -> 1: in to the cart, shrinking and fading.
      Animated.timing(progress, {
        toValue: 1,
        duration: TO_CART_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Landed. Dropping it from the list unmounts the image; leaving them
      // mounted would pile up one invisible bag per add for the session.
      setFlights((current) => current.filter((flight) => flight.id !== id));
    });
  }, []);

  const api = useMemo(() => ({ setCartAnchor, flyToCart }), [setCartAnchor, flyToCart]);

  return (
    <CartFlyContext.Provider value={api}>
      {children}
      {/*
        Rendered AFTER children and `pointerEvents="none"`, so it sits over
        every screen and intercepts nothing. `collapsable={false}` keeps the
        host view alive on Android when the flight list is momentarily empty.
      */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none" collapsable={false}>
        {flights.map((flight) => (
          <FlyingBag key={flight.id} flight={flight} />
        ))}
      </View>
    </CartFlyContext.Provider>
  );
}

/**
 * One bag in flight.
 *
 * Every animated property is a transform or opacity, so the whole thing runs
 * on the native driver — off the JS thread, and therefore smooth while the
 * catalogue is still loading images or the cart request is in flight.
 */
function FlyingBag({ flight }: { flight: Flight }) {
  const window = Dimensions.get('window');
  const centre = { x: window.width / 2, y: window.height / 2 };

  // Translations are of the image's top-left, so each waypoint is its centre
  // less half the bag.
  const half = BAG / 2;
  const translateX = flight.progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [flight.from.x - half, centre.x - half, flight.to.x - half],
  });
  const translateY = flight.progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [flight.from.y - half, centre.y - half, flight.to.y - half],
  });
  const scale = flight.progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [SCALE_START, SCALE_CENTRE, SCALE_END],
  });
  const opacity = flight.progress.interpolate({
    // Fades only at the very end, so it merges into the cart rather than
    // vanishing partway across the screen.
    inputRange: [0, 0.5, 0.85, 1],
    outputRange: [0.9, 1, 1, 0],
  });

  return (
    <Animated.Image
      // Replace `assets/cart-bag.png` to change the artwork; nothing here
      // depends on what the file contains.
      source={require('../../assets/cart-bag.png')}
      style={[
        styles.bag,
        { opacity, transform: [{ translateX }, { translateY }, { scale }] },
      ]}
      resizeMode="contain"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  bag: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BAG,
    height: BAG,
  },
});

export default CartFlyProvider;

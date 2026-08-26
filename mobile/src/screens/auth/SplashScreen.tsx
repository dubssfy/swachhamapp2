import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';

/**
 * ============================================================
 * TESTING SWITCH — set back to true before release.
 * ============================================================
 *
 * false: every cold start is signed out, so the app always runs the full
 *        Permission -> Mobile OTP -> Login flow. Any saved session is wiped
 *        on launch rather than merely ignored, because the API client reads
 *        the token straight from SecureStore and would otherwise keep sending
 *        it on requests the UI thinks are signed out.
 *
 * true:  normal behaviour. A saved session is restored and the user goes
 *        straight into the app, seeing login only after logging out.
 */
const RESTORE_SESSION_ON_LAUNCH = false;

/**
 * How long the splash is held before handing over.
 *
 * The fade-in alone runs for a second, so at the old 1500ms the artwork was
 * fully opaque for barely half a second — long enough to register that
 * something flashed, not long enough to read it. 3000 leaves a full two
 * seconds of settled logo and still keeps the launch brisk.
 *
 * This is a MINIMUM, not a delay added to the work: the timer only starts
 * once session restoration has finished, so a slow start is never made
 * slower by it.
 */
const SPLASH_HOLD_MS = 3000;

export default function SplashScreen({ navigation }: any) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const { isAuthenticated, isLoading, restoreSession, clearStoredSession } = useAuthStore();
  const sessionRestored = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 10,
        friction: 2,
        useNativeDriver: true,
      }),
    ]).start();

    if (!sessionRestored.current) {
      sessionRestored.current = true;
      if (RESTORE_SESSION_ON_LAUNCH) {
        restoreSession();
      } else {
        clearStoredSession();
      }
    }
  }, [fadeAnim, scaleAnim, restoreSession, clearStoredSession]);

  useEffect(() => {
    // Only move on once session restoration finished and the user is not
    // authenticated. If authenticated, AppNavigator unmounts this stack and
    // shows the signed-in app instead.
    //
    // Hand over to PermissionScreen, not login: location and camera are still
    // required before anyone reaches the login form.
    if (sessionRestored.current && !isLoading) {
      const timer = setTimeout(() => {
        if (!isAuthenticated) {
          navigation.replace('PermissionScreen');
        }
      }, SPLASH_HOLD_MS);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, isLoading, navigation]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.imageContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Image
          source={require('../../../assets/swachham-splash.jpg')}
          style={styles.splashImage}
          /*
           * CONTAIN, NOT COVER. The artwork is a tall 459x1024; `cover`
           * scales it until it fills the screen and throws away whatever
           * overflows, which on anything less slender than a phone meant the
           * wordmark being sliced off the bottom — on a 800x1280 tablet,
           * around 500px of it. `contain` fits the whole thing inside the box
           * at its own aspect ratio and centres it, so every part of the mark
           * survives on every screen shape.
           */
          resizeMode="contain"
          accessibilityLabel="Swachham Splash"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  imageContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    /*
     * The margin the brief asks for, and the reason the artwork is not
     * pinned to the screen's edges. `contain` already centres what it fits;
     * this keeps it off the rounded corners and the notch as well.
     */
    padding: SPACING.lg,
  },
  splashImage: {
    width: '100%',
    height: '100%',
  },
});

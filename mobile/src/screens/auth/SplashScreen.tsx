import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Image, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';

export default function SplashScreen({ navigation }: any) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  // The logo scales with the screen instead of sitting at a fixed 150px, and
  // stays square with resizeMode="contain", so it is never stretched or
  // cropped on a small phone or a tablet.
  const { width, height } = useWindowDimensions();
  const logoSize = Math.min(width * 0.55, height * 0.3, 260);

  const { isAuthenticated, isLoading, restoreSession } = useAuthStore();
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
      restoreSession();
    }
  }, [fadeAnim, scaleAnim, restoreSession]);

  useEffect(() => {
    // Only navigate to login if session restoration finished and user is not authenticated.
    // If authenticated, AppNavigator will automatically unmount this stack and show MainTab.
    if (sessionRestored.current && !isLoading) {
      const timer = setTimeout(() => {
        if (!isAuthenticated) {
          navigation.replace('LoginScreen');
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, isLoading, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View 
        style={[
          styles.logoContainer, 
          { 
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }]
          }
        ]}
      >
        {/* The one Swachham logo asset: also the app icon, the Android
            adaptive icon, the native splash image and the in-app header mark. */}
        <Image
          source={require('../../../assets/swachham-logo.png')}
          style={[styles.logo, { width: logoSize, height: logoSize }]}
          resizeMode="contain"
        />
        <Text style={styles.title}>SWACHHAM</Text>
        <Text style={styles.tagline}>Premium Laundry Care</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.Background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logo: {
    marginBottom: SPACING.lg,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxxl,
    fontWeight: 'bold',
    color: COLORS.PrimaryDark,
    letterSpacing: 2,
    marginBottom: SPACING.xs,
  },
  tagline: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
    letterSpacing: 1,
  },
});

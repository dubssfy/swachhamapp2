import React, { useCallback, useState } from 'react';

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  Linking,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import {
  useNavigation,
  useFocusEffect,
} from '@react-navigation/native';

import {
  COLORS,
  SPACING,
  TYPOGRAPHY,
  BORDER_RADIUS,
} from '../../constants/theme';


export default function PermissionScreen() {

  const navigation =
    useNavigation<any>();

  const [loading, setLoading] =
    useState(false);


  const [permissions, setPermissions] =
    useState({
      notifications: false,
      location: false,
      camera: false,
      photos: false,
    });


  // =====================================================
  // NOTIFICATIONS - OPTIONAL
  // =====================================================

  const requestNotifications =
    async () => {

      try {

        const { status } =
          await Notifications.requestPermissionsAsync();

        const granted =
          status === 'granted';

        setPermissions(prev => ({
          ...prev,
          notifications: granted,
        }));

        return granted;

      } catch (error) {

        console.error(
          'Notification permission error:',
          error
        );

        return false;
      }
    };


  // =====================================================
  // LOCATION - REQUIRED
  // =====================================================

  const requestLocation =
    async () => {

      try {

        const { status } =
          await Location.requestForegroundPermissionsAsync();

        const granted =
          status === 'granted';

        setPermissions(prev => ({
          ...prev,
          location: granted,
        }));

        return granted;

      } catch (error) {

        console.error(
          'Location permission error:',
          error
        );

        return false;
      }
    };


  // =====================================================
  // CAMERA - REQUIRED
  // =====================================================

  const requestCamera =
    async () => {

      try {

        const { status } =
          await Camera.requestCameraPermissionsAsync();

        const granted =
          status === 'granted';

        setPermissions(prev => ({
          ...prev,
          camera: granted,
        }));

        return granted;

      } catch (error) {

        console.error(
          'Camera permission error:',
          error
        );

        return false;
      }
    };


  // =====================================================
  // PHOTOS / MEDIA - OPTIONAL
  // =====================================================

  const requestPhotos =
    async () => {

      try {

        const result =
          await ImagePicker.requestMediaLibraryPermissionsAsync();

        const granted =
          result.status === 'granted';

        setPermissions(prev => ({
          ...prev,
          photos: granted,
        }));

        return granted;

      } catch (error) {

        console.error(
          'Photo permission error:',
          error
        );

        return false;
      }
    };


  // =====================================================
  // CHECK REQUIRED PERMISSIONS EVERY TIME SCREEN OPENS
  // =====================================================

  useFocusEffect(
    useCallback(() => {

      let isActive = true;


      const checkRequiredPermissions =
        async () => {

          try {

            setLoading(true);

            /*
             * Camera is REQUIRED. Location is OPTIONAL.
             *
             * Every time this screen receives focus,
             * we check their current OS permission status.
             *
             * This is important because the user may have
             * changed the permission from phone Settings.
             */

            const locationStatus =
              await Location.getForegroundPermissionsAsync();

            const cameraStatus =
              await Camera.getCameraPermissionsAsync();


            if (isActive) {

              setPermissions(prev => ({
                ...prev,

                location:
                  locationStatus.status === 'granted',

                camera:
                  cameraStatus.status === 'granted',
              }));
            }

          } catch (error) {

            console.error(
              'Required permission check error:',
              error
            );

          } finally {

            if (isActive) {
              setLoading(false);
            }
          }
        };


      checkRequiredPermissions();


      return () => {
        isActive = false;
      };

    }, [])
  );


  // =====================================================
  // CONTINUE
  // =====================================================

  const handleContinue =
    async () => {

      try {

        setLoading(true);


        /*
         * Location is OPTIONAL for entering the app.
         *
         * We still ask for it here so the permission is
         * usually already granted by the time a feature
         * needs it, but denying it must NOT block entry.
         * Store Locator requests location itself when the
         * user actually opens that feature.
         */

        await requestLocation();


        const cameraGranted =
          await requestCamera();


        /*
         * If camera is not granted, STOP.
         *
         * User cannot enter the next screen.
         */

        if (!cameraGranted) {

          Alert.alert(
            'Camera Permission Required',
            'Camera permission is required to continue. Please allow Camera access.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Open Settings',
                onPress: () => {
                  Linking.openSettings();
                },
              },
            ]
          );

          return;
        }


        /*
         * =================================================
         * BOTH REQUIRED PERMISSIONS GRANTED
         * =================================================
         *
         * Optional permissions can now be requested.
         *
         * They DO NOT block the user.
         */

        await requestNotifications();
        await requestPhotos();


        /*
         * =================================================
         * IMPORTANT AUTHENTICATION FLOW
         * =================================================
         *
         * DO NOT go directly to LoginScreen.
         *
         * Required flow:
         *
         * Permission
         *      ↓
         * Mobile OTP
         *      ↓
         * Login
         *
         * reset() also prevents the user from pressing
         * Back and returning to the permission screen.
         */

        navigation.reset({
          index: 0,

          routes: [
            {
              name: 'MobileVerificationScreen',

              /*
               * This parameter identifies this OTP as
               * ENTRY verification.
               *
               * Your MobileVerificationScreen can use
               * this to distinguish it from registration
               * or password-reset OTP.
               */
              params: {
                verificationPurpose: 'ENTRY',
              },
            },
          ],
        });

      } catch (error) {

        console.error(
          'Permission setup error:',
          error
        );

        Alert.alert(
          'Permission Error',
          'Unable to complete permission setup. Please try again.'
        );

      } finally {

        setLoading(false);
      }
    };


  // =====================================================
  // INDIVIDUAL PERMISSION
  // =====================================================

  const handlePermissionPress =
    async (
      type:
        | 'notifications'
        | 'location'
        | 'camera'
        | 'photos'
    ) => {

      if (type === 'notifications') {

        await requestNotifications();

        return;
      }


      if (type === 'location') {

        /*
         * Optional: declining location does not stop the user
         * from continuing. Store Locator asks again when it
         * is actually opened.
         */
        await requestLocation();

        return;
      }


      if (type === 'camera') {

        const granted =
          await requestCamera();


        if (!granted) {

          Alert.alert(
            'Camera Required',
            'Camera permission is required to continue. Please enable Camera permission in your phone settings.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Open Settings',
                onPress: () => {
                  Linking.openSettings();
                },
              },
            ]
          );
        }

        return;
      }


      if (type === 'photos') {

        await requestPhotos();

        return;
      }
    };


  // =====================================================
  // REQUIRED PERMISSIONS STATUS
  // =====================================================

  // Location is optional — it never blocks entry into the app.
  const requiredPermissionsGranted =
    permissions.camera;


  // =====================================================
  // UI
  // =====================================================

  return (

    <SafeAreaView
      style={styles.container}
    >

      <StatusBar
        barStyle="dark-content"
        backgroundColor={
          COLORS.Background
        }
      />


      <View style={styles.content}>

        {/* =================================================
            HEADER
        ================================================= */}

        <View style={styles.header}>

          <View style={styles.headerIcon}>

            <Ionicons
              name="shield-checkmark-outline"
              size={42}
              color={COLORS.Primary}
            />

          </View>


          <Text style={styles.title}>
            Allow Permissions
          </Text>


          <Text style={styles.subtitle}>
            Swachham needs a few permissions
            to provide you with the best
            experience.
          </Text>

        </View>


        {/* =================================================
            PERMISSIONS
        ================================================= */}

        <View style={styles.permissions}>

          {/* NOTIFICATIONS */}

          <PermissionCard
            icon="notifications-outline"
            title="Notifications"
            description="Get updates about your orders and deliveries."
            granted={
              permissions.notifications
            }
            required={false}
            onPress={() =>
              handlePermissionPress(
                'notifications'
              )
            }
          />


          {/* LOCATION - OPTIONAL */}

          <PermissionCard
            icon="location-outline"
            title="Location"
            description="Used for accurate pickup and delivery, and to find your nearest store."
            granted={
              permissions.location
            }
            required={false}
            onPress={() =>
              handlePermissionPress(
                'location'
              )
            }
          />


          {/* CAMERA - REQUIRED */}

          <PermissionCard
            icon="camera-outline"
            title="Camera"
            description="Required to take photos for your profile and services."
            granted={
              permissions.camera
            }
            required={true}
            onPress={() =>
              handlePermissionPress(
                'camera'
              )
            }
          />


          {/* PHOTOS */}

          <PermissionCard
            icon="images-outline"
            title="Photos & Media"
            description="Select photos for your profile and business."
            granted={
              permissions.photos
            }
            required={false}
            onPress={() =>
              handlePermissionPress(
                'photos'
              )
            }
          />

        </View>


        {/* =================================================
            REQUIRED PERMISSION MESSAGE
        ================================================= */}

        {!requiredPermissionsGranted && (

          <View
            style={
              styles.warningContainer
            }
          >

            <Ionicons
              name="information-circle-outline"
              size={20}
              color={COLORS.Primary}
            />


            <Text
              style={styles.warningText}
            >
              Camera permission is required
              to continue.
            </Text>

          </View>

        )}


        {/* =================================================
            CONTINUE
        ================================================= */}

        {/*
          Continue is NOT gated on the camera permission.
          handleContinue requests Camera itself and refuses to move on if it is
          denied, so gating the button on the permission only made the screen a
          dead end: the button that asks for Camera cannot be pressed until
          Camera is already granted, and a user who does not think to tap the
          Camera row can never leave this screen.
        */}
        <TouchableOpacity
          style={[
            styles.continueButton,
            loading && styles.buttonDisabled,
          ]}
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.8}
        >

          <Text
            style={styles.continueText}
          >
            {
              loading
                ? 'Checking Permissions...'
                : 'Continue'
            }
          </Text>


          {!loading && (

            <Ionicons
              name="arrow-forward"
              size={20}
              color="#fff"
            />

          )}

        </TouchableOpacity>


        <Text style={styles.footerText}>
          You can change these permissions
          anytime from your phone settings.
        </Text>

      </View>

    </SafeAreaView>
  );
}


// =====================================================
// PERMISSION CARD
// =====================================================

type PermissionCardProps = {

  icon:
    keyof typeof Ionicons.glyphMap;

  title: string;

  description: string;

  granted: boolean;

  required: boolean;

  onPress: () => void;
};


function PermissionCard({
  icon,
  title,
  description,
  granted,
  required,
  onPress,
}: PermissionCardProps) {

  return (

    <TouchableOpacity
      style={styles.permissionCard}
      onPress={onPress}
      activeOpacity={0.8}
    >

      <View
        style={styles.permissionIcon}
      >

        <Ionicons
          name={icon}
          size={25}
          color={COLORS.Primary}
        />

      </View>


      <View
        style={styles.permissionText}
      >

        <View
          style={styles.titleRow}
        >

          <Text
            style={styles.permissionTitle}
          >
            {title}
          </Text>


          {required && (

            <Text
              style={styles.requiredText}
            >
              REQUIRED
            </Text>

          )}

        </View>


        <Text
          style={
            styles.permissionDescription
          }
        >
          {description}
        </Text>

      </View>


      {granted ? (

        <Ionicons
          name="checkmark-circle"
          size={26}
          color={COLORS.Primary}
        />

      ) : (

        <Ionicons
          name="chevron-forward"
          size={22}
          color={COLORS.TextSecondary}
        />

      )}

    </TouchableOpacity>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles =
  StyleSheet.create({

    container: {
      flex: 1,
      backgroundColor:
        COLORS.Background,
    },


    content: {
      flex: 1,
      paddingHorizontal:
        SPACING.lg,
      justifyContent: 'center',
    },


    // ===================================================
    // HEADER
    // ===================================================

    header: {
      alignItems: 'center',
      marginBottom:
        SPACING.lg,
    },


    headerIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor:
        '#E8F5E9',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom:
        SPACING.md,
    },


    title: {
      fontSize:
        TYPOGRAPHY.sizes.xxl,
      fontWeight:
        TYPOGRAPHY.weights.bold,
      color:
        COLORS.TextPrimary,
      textAlign: 'center',
      marginBottom:
        SPACING.sm,
    },


    subtitle: {
      fontSize:
        TYPOGRAPHY.sizes.base,
      color:
        COLORS.TextSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },


    // ===================================================
    // PERMISSIONS
    // ===================================================

    permissions: {
      gap: SPACING.sm,
      marginBottom:
        SPACING.md,
    },


    permissionCard: {
      minHeight: 75,
      backgroundColor:
        COLORS.Surface,
      borderWidth: 1,
      borderColor:
        COLORS.Border,
      borderRadius:
        BORDER_RADIUS.md,
      paddingHorizontal:
        SPACING.md,
      paddingVertical:
        SPACING.sm,
      flexDirection: 'row',
      alignItems: 'center',
    },


    permissionIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor:
        '#E8F5E9',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight:
        SPACING.sm,
    },


    permissionText: {
      flex: 1,
    },


    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
    },


    permissionTitle: {
      fontSize:
        TYPOGRAPHY.sizes.base,
      fontWeight:
        TYPOGRAPHY.weights.semibold,
      color:
        COLORS.TextPrimary,
      marginBottom: 3,
    },


    requiredText: {
      fontSize: 9,
      fontWeight: '700',
      color:
        COLORS.Primary,
      marginBottom: 3,
    },


    permissionDescription: {
      fontSize:
        TYPOGRAPHY.sizes.sm,
      color:
        COLORS.TextSecondary,
      lineHeight: 18,
    },


    // ===================================================
    // WARNING
    // ===================================================

    warningContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        '#E8F5E9',
      borderRadius:
        BORDER_RADIUS.md,
      paddingHorizontal:
        SPACING.md,
      paddingVertical:
        SPACING.sm,
      marginBottom:
        SPACING.md,
    },


    warningText: {
      flex: 1,
      marginLeft:
        SPACING.sm,
      fontSize:
        TYPOGRAPHY.sizes.sm,
      color:
        COLORS.TextSecondary,
      lineHeight: 18,
    },


    // ===================================================
    // CONTINUE BUTTON
    // ===================================================

    continueButton: {
      height: 54,
      backgroundColor:
        COLORS.Primary,
      borderRadius:
        BORDER_RADIUS.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
    },


    buttonDisabled: {
      opacity: 0.5,
    },


    continueText: {
      color: '#fff',
      fontSize:
        TYPOGRAPHY.sizes.lg,
      fontWeight:
        TYPOGRAPHY.weights.semibold,
    },


    // ===================================================
    // FOOTER
    // ===================================================

    footerText: {
      textAlign: 'center',
      marginTop:
        SPACING.md,
      fontSize:
        TYPOGRAPHY.sizes.sm,
      color:
        COLORS.TextSecondary,
    },

  });
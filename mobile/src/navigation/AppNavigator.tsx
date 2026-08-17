import React from 'react';

import {
  NavigationContainer,
} from '@react-navigation/native';

import {
  createNativeStackNavigator,
} from '@react-navigation/native-stack';

import {
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';

import {
  Ionicons,
} from '@expo/vector-icons';

import {
  useAuthStore,
} from '../store/authStore';


// =========================================================
// AUTH / ONBOARDING SCREENS
// =========================================================

import PermissionScreen
  from '../screens/auth/PermissionScreen';

import MobileVerificationScreen
  from '../screens/auth/MobileVerificationScreen';

import LoginScreen
  from '../screens/auth/LoginScreen';

import CustomerRegisterScreen
  from '../screens/auth/CustomerRegisterScreen';

import BusinessRegisterScreen
  from '../screens/auth/BusinessRegisterScreen';

import ForgotPasswordScreen
  from '../screens/auth/ForgotPasswordScreen';

import ResetPasswordScreen
  from '../screens/auth/ResetPasswordScreen';


// =========================================================
// MAIN SCREENS
// =========================================================

import ProfileScreen
  from '../screens/profile/ProfileScreen';

import ProfileSetupScreen
  from '../screens/profile/ProfileSetupScreen';

import HomeScreen
  from '../screens/home/HomeScreen';

import CartScreen
  from '../screens/cart/CartScreen';

import CustomerOrdersScreen
  from '../screens/orders/CustomerOrdersScreen';

import CheckoutScreen
  from '../screens/cart/CheckoutScreen';

import AddressListScreen
  from '../screens/addresses/AddressListScreen';

import AddAddressScreen
  from '../screens/addresses/AddAddressScreen';

import EditAddressScreen
  from '../screens/addresses/EditAddressScreen';

import BusinessListScreen
  from '../screens/business/BusinessListScreen';

import BusinessDetailsScreen
  from '../screens/business/BusinessDetailsScreen';

/*
 * Order Type and Laundry Type are ONE page (OrderTypeScreen). There are no
 * longer separate LaundryType / ServiceType screens — service is chosen in the
 * Cart, before the order can be confirmed.
 */
import OrderTypeScreen
  from '../screens/business/OrderTypeScreen';

import BusinessCategoriesScreen
  from '../screens/business/BusinessCategoriesScreen';


import BusinessCartScreen
  from '../screens/business/BusinessCartScreen';


import BusinessProfileScreen
  from '../screens/business/BusinessProfileScreen';

import BusinessProfileDetailsScreen
  from '../screens/business/BusinessProfileDetailsScreen';

import StoreLocatorScreen
  from '../screens/business/StoreLocatorScreen';

import BusinessOrdersScreen
  from '../screens/business/BusinessOrdersScreen';

import BusinessOrderDetailsScreen
  from '../screens/business/BusinessOrderDetailsScreen';

import BusinessOrderTrackingScreen
  from '../screens/business/BusinessOrderTrackingScreen';


import BusinessFooter
  from '../components/business/BusinessFooter';


// =========================================================
// NAVIGATORS
// =========================================================

const Stack =
  createNativeStackNavigator();

const Tab =
  createBottomTabNavigator();



// =========================================================
// CART STACK
// =========================================================

function CartStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >

      <Stack.Screen
        name="CartScreen"
        component={CartScreen}
      />

      <Stack.Screen
        name="CheckoutScreen"
        component={CheckoutScreen}
      />

    </Stack.Navigator>
  );
}


// =========================================================
// CUSTOMER TABS
//
// Customer-only screens. Never points at a Business screen.
// =========================================================

const CUSTOMER_TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Orders: 'list-outline',
  Cart: 'cart-outline',
  Profile: 'person-outline',
};

function MainTab() {

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({

        headerShown: false,

        tabBarIcon: ({ color, size }) => (
          <Ionicons
            name={CUSTOMER_TAB_ICONS[route.name] || 'home-outline'}
            size={size}
            color={color}
          />
        ),

        tabBarActiveTintColor: '#2D6A4F',

        tabBarInactiveTintColor: 'gray',
      })}
    >

      <Tab.Screen
        name="Home"
        component={HomeScreen}
      />

      <Tab.Screen
        name="Orders"
        component={CustomerOrdersScreen}
      />

      <Tab.Screen
        name="Cart"
        component={CartStack}
      />

      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
      />

    </Tab.Navigator>
  );
}


// =========================================================
// CUSTOMER STACK
// =========================================================

function CustomerStack() {

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >

      <Stack.Screen
        name="MainTab"
        component={MainTab}
      />

      <Stack.Screen
        name="EditProfile"
        component={ProfileSetupScreen}
      />

      <Stack.Screen
        name="AddressList"
        component={AddressListScreen}
      />

      <Stack.Screen
        name="AddAddress"
        component={AddAddressScreen}
      />

      <Stack.Screen
        name="EditAddress"
        component={EditAddressScreen}
      />

      <Stack.Screen
        name="BusinessList"
        component={BusinessListScreen}
      />

      <Stack.Screen
        name="BusinessDetails"
        component={BusinessDetailsScreen}
      />

    </Stack.Navigator>
  );
}


// =========================================================
// BUSINESS SECTION
//
// Four independent stacks, one per bottom tab, so nested
// screens (order details, tracking, checkout) push inside
// their own tab without leaving the Business section.
// =========================================================

function BusinessHomeStack() {
  return (
    <Stack.Navigator
      initialRouteName="OrderTypeScreen"
      screenOptions={{ headerShown: false }}
    >
      {/* One page for Standard/Quick + Hotel/Guest, then straight to items. */}
      <Stack.Screen name="OrderTypeScreen" component={OrderTypeScreen} />
      <Stack.Screen name="BusinessCategoriesScreen" component={BusinessCategoriesScreen} />
    </Stack.Navigator>
  );
}

function BusinessOrdersStack() {
  return (
    <Stack.Navigator
      initialRouteName="BusinessOrdersScreen"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="BusinessOrdersScreen" component={BusinessOrdersScreen} />
      <Stack.Screen name="BusinessOrderDetailsScreen" component={BusinessOrderDetailsScreen} />
      <Stack.Screen name="BusinessOrderTrackingScreen" component={BusinessOrderTrackingScreen} />
    </Stack.Navigator>
  );
}

function BusinessCartStack() {
  return (
    <Stack.Navigator
      initialRouteName="BusinessCartScreen"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="BusinessCartScreen" component={BusinessCartScreen} />
    </Stack.Navigator>
  );
}

function BusinessProfileStack() {
  return (
    <Stack.Navigator
      initialRouteName="BusinessProfileScreen"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="BusinessProfileScreen" component={BusinessProfileScreen} />
      <Stack.Screen name="BusinessProfileDetailsScreen" component={BusinessProfileDetailsScreen} />
      <Stack.Screen name="StoreLocatorScreen" component={StoreLocatorScreen} />
    </Stack.Navigator>
  );
}


// =========================================================
// BUSINESS TABS
//
// The shared Business Footer is the tab bar itself, so the
// footer exists once and React Navigation owns active state.
// =========================================================

function BusinessTabs() {
  return (
    <Tab.Navigator
      initialRouteName="BusinessHome"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BusinessFooter {...props} />}
    >
      <Tab.Screen name="BusinessHome" component={BusinessHomeStack} />
      <Tab.Screen name="BusinessOrders" component={BusinessOrdersStack} />
      <Tab.Screen name="BusinessCart" component={BusinessCartStack} />
      <Tab.Screen name="BusinessProfile" component={BusinessProfileStack} />
    </Tab.Navigator>
  );
}


// =========================================================
// ROOT NAVIGATOR
// =========================================================

export default function AppNavigator() {

  const {
    isAuthenticated,
    user,
    userType,
  } = useAuthStore();


  /*
   * Normalize role.
   *
   * CUSTOMER -> customer
   * BUSINESS -> business
   */
  const role =
    user?.role
      ? String(user.role).toLowerCase()
      : userType
        ? String(userType).toLowerCase()
        : null;


  return (

    <NavigationContainer>

      <Stack.Navigator
        initialRouteName="PermissionScreen"
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
        }}
      >

        {/* =================================================
            STEP 1
            PERMISSION SCREEN
           
            This MUST be the first screen.
           
            User cannot enter Login until:
            Location = granted
            Camera = granted
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="PermissionScreen"
            component={
              PermissionScreen
            }
          />

        )}


        {/* =================================================
            STEP 2
            MOBILE OTP VERIFICATION
           
            PermissionScreen must navigate here only after
            both permissions have been granted.
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="MobileVerificationScreen"
            component={
              MobileVerificationScreen
            }
          />

        )}


        {/* =================================================
            STEP 3
            LOGIN
           
            MobileVerificationScreen must navigate here
            only after successful OTP verification.
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="LoginScreen"
            component={
              LoginScreen
            }
          />

        )}


        {/* =================================================
            CUSTOMER REGISTRATION
           
            Only available from Customer Login.
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="CustomerRegisterScreen"
            component={
              CustomerRegisterScreen
            }
          />

        )}


        {/* =================================================
            BUSINESS REGISTRATION
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="BusinessRegisterScreen"
            component={
              BusinessRegisterScreen
            }
          />

        )}


        {/* =================================================
            FORGOT PASSWORD
           
            Only available from Customer Login.
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="ForgotPasswordScreen"
            component={
              ForgotPasswordScreen
            }
          />

        )}


        {/* =================================================
            RESET PASSWORD
        ================================================= */}

        {!isAuthenticated && (

          <Stack.Screen
            name="ResetPasswordScreen"
            component={
              ResetPasswordScreen
            }
          />

        )}


        {/* =================================================
            CUSTOMER APPLICATION
        ================================================= */}

        {isAuthenticated &&
          role === 'customer' && (

          <Stack.Screen
            name="Customer"
            component={
              CustomerStack
            }
          />

        )}


        {/* =================================================
            BUSINESS APPLICATION
        ================================================= */}

        {isAuthenticated &&
          role === 'business' && (

          <Stack.Screen
            name="Business"
            component={
              BusinessTabs
            }
          />

        )}

      </Stack.Navigator>

    </NavigationContainer>
  );
}
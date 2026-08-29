import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

/* THE CUSTOMER PALETTE, imported under the name `COLORS`.
 *
 * #3d6173 and #ffbd4a. Aliased rather than renamed at every use so this
 * screen reads the same as the rest of the app, and so the green `COLORS`
 * -- which the business, sorter, rider and super-admin screens all import --
 * is left exactly as it is. See `CUSTOMER_COLORS` in constants/theme. */
import {
  CUSTOMER_COLORS as COLORS,
  SPACING,
  TYPOGRAPHY,
  BORDER_RADIUS,
} from '../../constants/theme';

import {
  customerCatalogueApi,
  CustomerCategory,
} from '../../services/customerCartApi';

import { useAuthStore } from '../../store/authStore';
import CartIconButton from './CartIconButton';

/**
 * CUSTOMER HOME SCREEN
 *
 * Features:
 * - No Laundry Type page
 * - No Business Name
 * - Three-image promotional carousel
 * - Four category image buttons
 * - Larger category images
 * - Increased vertical gap between category rows
 * - Working Cart button
 * - Categories connected to existing API
 * - Women's Wear routing fixed
 * - Images fit completely inside containers
 * - No category names below images
 * - No item count
 * - No View All Categories button
 */

type CategoryConfig = {
  key: string;
  image: any;
  borderColor: string;
};

/**
 * CATEGORY IMAGES
 *
 * Location:
 *
 * src/assets/images/mens.png
 * src/assets/images/womens.png
 * src/assets/images/household.png
 * src/assets/images/others.png
 */

const MAIN_CATEGORIES: CategoryConfig[] = [
  {
    key: 'mens',
    image: require('../../assets/images/mens.png'),
    borderColor: '#ffbd4a',
  },
  {
    key: 'womens',
    image: require('../../assets/images/womens.png'),
    borderColor: '#3d6f73',
  },
  {
    key: 'household',
    image: require('../../assets/images/household.png'),
    borderColor: '#3d6f73',
  },
  {
    key: 'others',
    image: require('../../assets/images/others.png'),
    borderColor: '#ffbd4a',
  },
];

/**
 * PROMOTIONAL CAROUSEL IMAGES
 *
 * Location:
 *
 * src/assets/images/c1.png
 * src/assets/images/c2.png
 * src/assets/images/c3.png
 */
const CAROUSEL_IMAGES = [
  require('../../assets/images/c1.png'),
  require('../../assets/images/c2.png'),
  require('../../assets/images/c3.png'),
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Carousel is intentionally wider/taller than the category buttons.
 */
const CAROUSEL_WIDTH = SCREEN_WIDTH - SPACING.md * 2;
const CAROUSEL_HEIGHT = Math.min(
  CAROUSEL_WIDTH * 0.46,
  205
);

/**
 * Normalize category names received from backend.
 *
 * Examples:
 *
 * Men's Wear   -> menswear
 * Mens Wear    -> menswear
 * Women's Wear -> womenswear
 * Household    -> household
 * Others       -> others
 */
const normalizeCategoryName = (
  value: string = ''
): string => {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, '');
};

/**
 * Convert backend category names into
 * customer-facing category keys.
 *
 * IMPORTANT:
 *
 * Women's Wear is checked BEFORE Men's Wear.
 *
 * This prevents:
 *
 * womenswear
 *
 * from accidentally matching:
 *
 * menswear
 */
const getCategoryKey = (
  categoryName: string = ''
): string => {
  const normalized =
    normalizeCategoryName(categoryName);

  /* =====================================================
     WOMEN'S WEAR
  ===================================================== */

  if (
    normalized === 'womens' ||
    normalized === 'womenswear' ||
    normalized.includes('womenswear') ||
    normalized.includes('women')
  ) {
    return 'womens';
  }

  /* =====================================================
     MEN'S WEAR
  ===================================================== */

  if (
    normalized === 'mens' ||
    normalized === 'menswear' ||
    normalized.includes('menswear')
  ) {
    return 'mens';
  }

  /* =====================================================
     HOUSEHOLD
  ===================================================== */

  if (
    normalized === 'household' ||
    normalized.includes('household') ||
    normalized === 'home'
  ) {
    return 'household';
  }

  /* =====================================================
     OTHERS
  ===================================================== */

  if (
    normalized === 'others' ||
    normalized.includes('other')
  ) {
    return 'others';
  }

  return normalized;
};

export default function CustomerHomeScreen({
  navigation,
}: any) {
  const { user } = useAuthStore();

  const [categories, setCategories] =
    useState<CustomerCategory[]>([]);

  const [loadingCategories, setLoadingCategories] =
    useState(true);

  const [carouselIndex, setCarouselIndex] =
    useState(0);

  const carouselRef =
    useRef<ScrollView>(null);

  const name = user?.name || 'there';

  /* =====================================================
     LOAD CATEGORIES
  ===================================================== */

  useEffect(() => {
    let mounted = true;

    setLoadingCategories(true);

    customerCatalogueApi
      .getCategories()
      .then((data) => {
        if (mounted) {
          setCategories(data || []);
        }
      })
      .catch(() => {
        if (mounted) {
          setCategories([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingCategories(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  /* =====================================================
     AUTO CAROUSEL
  ===================================================== */

  useEffect(() => {
    if (CAROUSEL_IMAGES.length <= 1) {
      return;
    }

    const timer = setInterval(() => {
      setCarouselIndex((current) => {
        const next =
          (current + 1) % CAROUSEL_IMAGES.length;

        carouselRef.current?.scrollTo({
          x: next * CAROUSEL_WIDTH,
          animated: true,
        });

        return next;
      });
    }, 3500);

    return () => {
      clearInterval(timer);
    };
  }, []);

  /* =====================================================
     FIND BACKEND CATEGORY
  ===================================================== */

  const findCategory = (
    categoryKey: string
  ) => {
    return categories.find((category) => {
      const backendCategoryKey =
        getCategoryKey(
          String(category.name || '')
        );

      return (
        backendCategoryKey === categoryKey
      );
    });
  };

  /* =====================================================
     OPEN CATEGORY
  ===================================================== */

  const openCategory = (
    categoryConfig: CategoryConfig
  ) => {
    const category = findCategory(
      categoryConfig.key
    );

    /*
     * If the category doesn't exist in backend,
     * do nothing.
     */
    if (!category) {
      return;
    }

    /*
     * Use the actual backend category ID.
     *
     * This keeps each category connected to
     * the correct CustomerItems screen.
     */
    navigation.navigate('CustomerItems', {
      categoryId: category.id,
      categoryName: category.name,
    });
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
    >
      {/* =====================================================
          LOGO
      ====================================================== */}

      <View style={styles.logoWrap}>
        <Image
          source={require(
            '../../../assets/swachham-header-logo.png'
          )}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Swachham"
        />
      </View>

      {/* =====================================================
          HEADER
      ====================================================== */}

      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.greeting}>
            Hello,
          </Text>

          <Text
            style={styles.name}
            numberOfLines={1}
          >
            {name}
          </Text>
        </View>

        {/* CART BUTTON */}
        <CartIconButton
          navigation={navigation}
        />
      </View>

      {/* =====================================================
          MAIN CONTENT
      ====================================================== */}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ===================================================
            PROMOTIONAL CAROUSEL
        ==================================================== */}

        <View style={styles.carouselSection}>
          <ScrollView
            ref={carouselRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            snapToInterval={CAROUSEL_WIDTH}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => {
              const index = Math.round(
                event.nativeEvent.contentOffset.x /
                  CAROUSEL_WIDTH
              );

              setCarouselIndex(
                Math.max(
                  0,
                  Math.min(
                    index,
                    CAROUSEL_IMAGES.length - 1
                  )
                )
              );
            }}
          >
            {CAROUSEL_IMAGES.map((image, index) => (
              <TouchableOpacity
                key={`carousel-${index}`}
                activeOpacity={0.95}
                style={[
                  styles.carouselCard,
                  {
                    width: CAROUSEL_WIDTH,
                    height: CAROUSEL_HEIGHT,
                  },
                ]}
              >
                <Image
                  source={image}
                  style={styles.carouselImage}
                  resizeMode="cover"
                  accessibilityLabel={`Promotional banner ${
                    index + 1
                  }`}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Carousel indicators */}
          <View style={styles.carouselIndicators}>
            {CAROUSEL_IMAGES.map((_, index) => (
              <View
                key={`indicator-${index}`}
                style={[
                  styles.carouselDot,
                  index === carouselIndex &&
                    styles.carouselDotActive,
                ]}
              />
            ))}
          </View>
        </View>

        {/* ===================================================
            SELECT ITEMS HEADER
        ==================================================== */}

        <View style={styles.sectionHeader}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>
              SELECT ITEMS
            </Text>

            <Text style={styles.sectionSubtitle}>
              Select a category to continue
            </Text>
          </View>

          <Ionicons
            name="grid-outline"
            size={23}
            color={COLORS.PrimaryDark}
          />
        </View>

        {/* ===================================================
            CATEGORY IMAGE BUTTONS
        ==================================================== */}

        {loadingCategories ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="small"
              color={COLORS.PrimaryDark}
            />

            <Text style={styles.loadingText}>
              Loading categories...
            </Text>
          </View>
        ) : (
          <View style={styles.categoryGrid}>
            {MAIN_CATEGORIES.map(
              (categoryConfig) => {
                const category =
                  findCategory(
                    categoryConfig.key
                  );

                return (
                  <TouchableOpacity
                    key={categoryConfig.key}
                    style={[
                      styles.categoryCard,
                      !category &&
                        styles.categoryCardDisabled,
                    ]}
                    onPress={() =>
                      openCategory(
                        categoryConfig
                      )
                    }
                    disabled={!category}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel={
                      categoryConfig.key
                    }
                  >
                    {/* =======================================
                        CATEGORY IMAGE
                    ======================================== */}

                    <View
                      style={[
                        styles.categoryImageWrapper,
                        {
                          borderColor:
                            categoryConfig.borderColor,
                        },
                      ]}
                    >
                      <Image
                        source={
                          categoryConfig.image
                        }
                        style={
                          styles.categoryImage
                        }
                        resizeMode="contain"
                        accessibilityLabel={`${categoryConfig.key} category`}
                      />

                      {/* ===================================
                          ARROW
                      ==================================== */}

                      {category && (
                        <View
                          style={
                            styles.arrowButton
                          }
                        >
                          <Ionicons
                            name="chevron-forward"
                            size={19}
                            color={
                              COLORS.PrimaryDark
                            }
                          />
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }
            )}
          </View>
        )}

        {/* ===================================================
            BOTTOM SPACE FOR NAVIGATION
        ==================================================== */}

        <View style={styles.bottomSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  /* =======================================================
     MAIN CONTAINER
  ======================================================== */

  container: {
    flex: 1,

    backgroundColor:
      COLORS.Background ?? '#F4F7F5',
  },

  flex: {
    flex: 1,
  },

  /* =======================================================
     LOGO
  ======================================================== */

  logoWrap: {
    width: '100%',

    alignItems: 'center',

    paddingTop: SPACING.xs,
  },

  logo: {
    width: '100%',

    height: 60,
  },

  /* =======================================================
     HEADER
  ======================================================== */

  header: {
    flexDirection: 'row',

    alignItems: 'center',

    gap: SPACING.sm,

    paddingHorizontal: SPACING.md,

    paddingBottom: SPACING.sm,
  },

  greeting: {
    fontFamily:
      TYPOGRAPHY.fontFamily,

    fontSize:
      TYPOGRAPHY.sizes.xs,

    color:
      COLORS.TextSecondary,
  },

  name: {
    fontFamily:
      TYPOGRAPHY.fontFamily,

    fontSize:
      TYPOGRAPHY.sizes.lg,

    fontWeight: '700',

    color:
      COLORS.TextPrimary,
  },

  /* =======================================================
     SCROLL
  ======================================================== */

  scroll: {
    paddingHorizontal: SPACING.md,
  },

  /* =======================================================
     PROMOTIONAL CAROUSEL
  ======================================================== */

  carouselSection: {
    width: '100%',
    marginBottom: SPACING.md,
  },

  carouselCard: {
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.Surface,

    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.10,
    shadowRadius: 7,

    elevation: 4,
  },

  carouselImage: {
    width: '100%',
    height: '100%',
  },

  carouselIndicators: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 9,
  },

  carouselDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.TextSecondary,
    opacity: 0.35,
  },

  carouselDotActive: {
    width: 20,
    opacity: 1,
    backgroundColor: COLORS.PrimaryDark,
  },

  /* =======================================================
     SELECT ITEMS HEADER
  ======================================================== */

  sectionHeader: {
    flexDirection: 'row',

    alignItems: 'center',

    marginBottom:
      SPACING.sm,

    gap: SPACING.sm,
  },

  sectionTitle: {
    fontFamily:
      TYPOGRAPHY.fontFamily,

    fontSize:
      TYPOGRAPHY.sizes.base,

    fontWeight: '800',

    color:
      COLORS.TextPrimary,

    letterSpacing: 0.5,
  },

  sectionSubtitle: {
    fontFamily:
      TYPOGRAPHY.fontFamily,

    fontSize:
      TYPOGRAPHY.sizes.xs,

    color:
      COLORS.TextSecondary,

    marginTop: 2,
  },

  /* =======================================================
     CATEGORY GRID
  ======================================================== */

  categoryGrid: {
    flexDirection: 'row',

    flexWrap: 'wrap',

    /*
     * Keep the two-column layout.
     */
    marginHorizontal: -5,
  },

  /* =======================================================
     CATEGORY CARD
  ======================================================== */

  categoryCard: {
    width: '50%',

    paddingHorizontal: 5,

    /*
     * Increased vertical gap between
     * first and second row.
     */
    marginBottom: 12,
  },

  categoryCardDisabled: {
    opacity: 0.6,
  },

  /* =======================================================
     CATEGORY IMAGE CONTAINER
  ======================================================== */

  categoryImageWrapper: {
    width: '100%',

    /*
     * Category image/card height.
     */
    height: 145,

    borderRadius:
      BORDER_RADIUS.md,

    /*
     * Category-specific border colors:
     * Men's Wear + Others   -> #ffbd4a
     * Women's Wear + Household -> #3d6f73
     */
    borderWidth: 2,

    overflow: 'hidden',

    backgroundColor:
      COLORS.Surface,

    position: 'relative',

    shadowColor: '#000',

    shadowOffset: {
      width: 0,
      height: 2,
    },

    shadowOpacity: 0.07,

    shadowRadius: 5,

    elevation: 2,
  },

  /* =======================================================
     CATEGORY IMAGE
  ======================================================== */

  categoryImage: {
    width: '100%',
    height: '100%',
    padding: 7,
  },

  /* =======================================================
     ARROW BUTTON
  ======================================================== */

  arrowButton: {
    position: 'absolute',

    right: 10,

    bottom: 10,

    width: 34,

    height: 34,

    borderRadius: 17,

    backgroundColor:
      COLORS.Surface,

    alignItems: 'center',

    justifyContent: 'center',

    shadowColor: '#000',

    shadowOffset: {
      width: 0,
      height: 1,
    },

    shadowOpacity: 0.12,

    shadowRadius: 3,

    elevation: 3,
  },

  /* =======================================================
     LOADING
  ======================================================== */

  loadingContainer: {
    minHeight: 180,

    alignItems: 'center',

    justifyContent: 'center',

    backgroundColor:
      COLORS.Surface,

    borderRadius:
      BORDER_RADIUS.md,

    marginBottom:
      SPACING.md,
  },

  loadingText: {
    fontFamily:
      TYPOGRAPHY.fontFamily,

    fontSize:
      TYPOGRAPHY.sizes.xs,

    color:
      COLORS.TextSecondary,

    marginTop:
      SPACING.xs,
  },

  /* =======================================================
     BOTTOM NAVIGATION SPACE
  ======================================================== */

  bottomSpace: {
    height: 96,
  },
});
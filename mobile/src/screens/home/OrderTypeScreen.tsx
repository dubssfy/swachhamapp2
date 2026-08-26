import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  useWindowDimensions,
  Animated,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import SectionHeading from '../../components/SectionHeading';
import {
  useBusinessOrderStore,
  LaundryType,
  OrderType,
  QUICK_ORDER_MULTIPLIER_FALLBACK,
} from '../../store/businessOrderStore';
import businessOrderApi from '../../services/businessOrderApi';

/*
 * The two order cards are the same card in two finishes, exactly as the Home
 * page's pair are: Standard is teal with the saffron accent on it, Quick is
 * the warm off-white inverse with the teal as its ink.
 */
/** The Standard card's surface, and the Quick card's ink. */
const CARD_TEAL = '#3d6f73';
/** The saffron accent, and the rate badge's plate. */
const CARD_SAFFRON = '#ffbd4a';
/** The Quick card's surface: the same warm off-white as the Guest card. */
const CARD_OFF_WHITE = '#FDF8F0';

/** How long one half of the surcharge badge's pulse takes. */
const PULSE_MS = 650;
/**
 * How bright the halo gets at the top of each pulse.
 *
 * High, because saffron on the card's off-white is only about 1.6:1 — at
 * half opacity the glow was there but easy to miss, which defeats the point
 * of a light that blinks.
 */
const PULSE_PEAK = 0.9;

/*
 * The rainbow the "2x RATE" ribbon's light cycles through. Six stops, no
 * repeated closing entry needed -- see how they are stepped through below.
 */
const RAINBOW_COLORS = [
  '#FF3B30', // red
  '#FF9500', // orange
  '#FFCC00', // yellow
  '#34C759', // green
  '#0A84FF', // blue
  '#AF52DE', // violet
];
/** How long each colour is held before the next one takes over. */
const RAINBOW_STEP_MS = 700;

/*
 * "STANDARD" is 5.83em wide at Roboto's regular advance widths, roughly
 * 6.06em once the 900 weight's slightly wider glyphs are accounted for — the
 * first pass at this used 5.1, underestimating by nearly a full em, which is
 * exactly what let "STANDARD" wrap to "STANDAR" / "D" on a 360dp phone: the
 * sizing function was confidently choosing a size the word did not actually
 * fit at. `LEFT_TITLE_WIDTH_IN_EMS` below carries a 5% margin past the
 * measured 6.06 for exactly that reason — font metrics are close enough to
 * verify by arithmetic but not identical across every device's Roboto build.
 */

/**
 * The narrow, solid-colour spine's share of the card's width — wider than
 * the 9:16 split this design started from. "STANDARD" does not fit one line
 * at ANY reasonable size inside a 36%-wide spine on a 360dp phone; at 40% it
 * does, with the detail panel giving up the difference.
 */
const LEFT_PANEL_FLEX = 10;
/** The wide, detail panel's share. */
const RIGHT_PANEL_FLEX = 15;

/** The largest the left panel's title is allowed to get. */
const LEFT_TITLE_MAX = 26;
/**
 * The smallest it may shrink to before readability outranks fitting. Lower
 * than the Home page's equivalent floor because this word is wider and this
 * column is narrower — the same arithmetic, run over a harder case.
 */
const LEFT_TITLE_MIN = 15;
/** How wide "STANDARD" is in multiples of its own font size, plus headroom. */
const LEFT_TITLE_WIDTH_IN_EMS = 6.4;

/**
 * The left panel's title size on THIS screen.
 *
 * The panel is a fixed share of the card's width (`LEFT_PANEL_FLEX` of
 * `LEFT_PANEL_FLEX + RIGHT_PANEL_FLEX`), so the size is derived from THAT
 * width, not the card's — sizing against the full card would overflow the
 * narrower column the reference design puts the title in.
 */
function leftTitleSize(cardWidth: number): number {
  const panelWidth = (cardWidth * LEFT_PANEL_FLEX) / (LEFT_PANEL_FLEX + RIGHT_PANEL_FLEX);
  // 4, not `SPACING.sm` (8): every pixel here is a pixel "STANDARD" needs
  // back on a narrow phone, and the spine's own colour block is margin
  // enough without extra padding eating into the one word that is tight.
  const inner = panelWidth - 4 * 2;
  return Math.max(LEFT_TITLE_MIN, Math.min(LEFT_TITLE_MAX, Math.floor(inner / LEFT_TITLE_WIDTH_IN_EMS)));
}

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

  const { width } = useWindowDimensions();
  // The card's own width, not the screen's: page padding (lg) and the
  // card's border eat into it before the split panels ever see it.
  const cardWidth = width - SPACING.lg * 2 - 2.5 * 2;
  const titleSize = leftTitleSize(cardWidth);

  /*
   * Whether a bottom tab bar sits under this screen.
   *
   * Inside the Business tabs it does, and the tab bar already ends above the
   * system navigation — so asking SafeAreaView for the bottom edge as well
   * would reserve that inset a SECOND time, as pure dead space at the foot of
   * a page that has none to spare. Pushed onto the Customer stack there is no
   * tab bar, and the inset is genuinely ours to keep.
   *
   * Reading the context rather than `useBottomTabBarHeight()` because that
   * hook throws outside a tab navigator, which is precisely the case being
   * detected.
   */
  /*
   * The surcharge badge's blinking light.
   *
   * IT IS A HALO BEHIND THE BADGE, NOT THE BADGE ITSELF. Fading the badge
   * would take "2x RATE" with it, and a surcharge that is unreadable for half
   * of every second is worse than one that does not blink at all. The plate
   * and its type stay fully opaque throughout; only the glow around them
   * comes and goes.
   *
   * Opacity only — no scale — so the halo can never grow across the chevron
   * sitting beside it, whatever the badge's width works out to.
   *
   * Driven natively, and skipped outright when the reader has asked the
   * system for reduced motion; a thing that blinks forever is exactly what
   * that setting exists to switch off.
   */
  const pulse = useRef(new Animated.Value(0)).current;
  /*
   * The rainbow itself.
   *
   * PLAIN REACT STATE STEPPED BY setInterval, deliberately NOT an Animated
   * value. Two earlier attempts at this drove the colour through
   * `Animated.Value.interpolate()` and both left the ribbon stuck on red
   * after the first sweep: a JS-driven `Animated.loop` restarts each lap from
   * the value's CURRENT position rather than from 0, so a repeating
   * one-directional `timing` reaches 1 once and then goes nowhere, which
   * resolves to the cycle's last stop — red — and looks exactly like a light
   * that never blinks. An explicit zero-duration reset step between laps was
   * meant to fix that and evidently still did not, on-device, reliably
   * enough to trust.
   *
   * A ticking index has no such failure mode: every `RAINBOW_STEP_MS` the
   * index advances, React re-renders with the next colour in
   * `RAINBOW_COLORS`, and there is no animation config whose internal reset
   * semantics this depends on.
   */
  const [rainbowIndex, setRainbowIndex] = useState(0);

  useEffect(() => {
    let pulseLoop: Animated.CompositeAnimation | undefined;
    let rainbowTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (cancelled || reduceMotion) return;

        pulseLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1,
              duration: PULSE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(pulse, {
              toValue: 0,
              duration: PULSE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        );
        pulseLoop.start();

        rainbowTimer = setInterval(() => {
          setRainbowIndex((i) => (i + 1) % RAINBOW_COLORS.length);
        }, RAINBOW_STEP_MS);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      pulseLoop?.stop();
      if (rainbowTimer) clearInterval(rainbowTimer);
    };
  }, [pulse]);

  const rainbowColor = RAINBOW_COLORS[rainbowIndex];

  const tabBarHeight = React.useContext(BottomTabBarHeightContext);
  const safeAreaEdges: Array<'top' | 'bottom'> =
    tabBarHeight == null ? ['top', 'bottom'] : ['top'];

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
    <SafeAreaView style={styles.container} edges={safeAreaEdges}>
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
        {/* The laundry type chosen on the page before this one. It was a
            badge in the body until now; up here it costs the cards no
            height, and the body no longer repeats it.

            No spacer opposite the back button any more: "Selected: Guest
            Laundry" is far longer than the word it replaced, and a 76px
            counterweight would have squeezed it into an ellipsis. It centres
            in the room that is left instead. */}
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Selected:</Text>
          {/* The same mark the card for this laundry type carries. It sits
              between the label and the name because it belongs to the NAME —
              it is the laundry type's own icon, not a bullet for the line. */}
          <Ionicons
            name={selectedLaundryType === 'guest' ? 'person' : 'business'}
            size={16}
            color={COLORS.Primary}
          />
          <Text style={styles.headerTitleStrong} numberOfLines={1}>
            {routeLaundryLabel}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* The same heading object the Home page uses, so the two steps of
            one question look like two steps of one question.

            The line of instruction that sat under it is gone: both cards
            already say what they are on their own rate tags, and its height
            was the difference between seeing both options and scrolling for
            the second. */}
        <SectionHeading>ORDER TYPE</SectionHeading>

        {/* ORDER TYPE CARDS: ONLY Standard Order and Quick Order (NO Priority Turnaround).

            Both cards share one shape: a narrow, solid-colour spine on one
            side carrying the icon and the name, and a wide off-white-or-teal
            panel on the other carrying the detail lines. Quick Order is the
            Standard card with that pairing FLIPPED -- its spine is the
            surface Standard's detail panel uses, and vice versa -- which is
            what makes the two read as a matched pair rather than two designs
            glued together. */}
        <View style={styles.cardsContainer}>
          {/* 1. STANDARD ORDER -- teal spine on the left, off-white detail panel on the right. */}
          <TouchableOpacity
            style={[styles.card, selectedOrderType === 'standard' && styles.cardActive]}
            onPress={() => handleSelectOrderType('standard')}
            activeOpacity={0.85}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Standard Order"
          >
            <View style={styles.cardRow}>
              <View style={[styles.spine, styles.spineTeal]}>
                <View style={[styles.spineIcon, styles.spineIconOnTeal]}>
                  <Ionicons name="calendar-outline" size={30} color="#FFFFFF" />
                </View>
                <Text style={[styles.spineTitle, styles.spineTitleOnTeal, { fontSize: titleSize }]}>
                  STANDARD
                </Text>
                <Text style={[styles.spineTitle, styles.spineTitleOnTeal, { fontSize: titleSize }]}>
                  ORDER
                </Text>
                <View style={[styles.spineUnderline, styles.spineUnderlineOnTeal]} />
              </View>

              <View style={[styles.detail, styles.detailOffWhite]}>
                {/* "Regular Rate" highlighted the same way Quick Order's
                    "Double Rate" is -- a nested <Text> with its own
                    background, not a separate element -- so the two cards'
                    rate lines read as the same kind of statement wherever the
                    text happens to wrap. */}
                <Text style={[styles.detailLine, styles.detailLineOnOffWhite]}>
                  Standard Turnaround {'\u00b7'}{' '}
                  <Text style={styles.rateHighlight}>Regular Rate</Text>
                </Text>
                <View style={[styles.detailDivider, styles.detailDividerOnOffWhite]} />
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={18} color={CARD_SAFFRON} />
                  <Text style={[styles.detailLine, styles.detailLineOnOffWhite]}>
                    Normal scheduled delivery
                  </Text>
                </View>
                <View style={[styles.detailDivider, styles.detailDividerOnOffWhite]} />
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={18} color={CARD_SAFFRON} />
                  <Text style={[styles.detailLine, styles.detailLineOnOffWhite]}>
                    Best value for regular laundry
                  </Text>
                </View>
              </View>
            </View>

            {/* The floating state indicator, the same circle on both cards so
                it reads as one control regardless of which way the colours
                are flipped underneath it. */}
            <View style={styles.stateBadgeWrap}>
              <View
                style={[
                  styles.stateBadge,
                  selectedOrderType === 'standard' && styles.stateBadgeActive,
                ]}
              >
                <Ionicons
                  name={selectedOrderType === 'standard' ? 'checkmark' : 'chevron-forward'}
                  size={selectedOrderType === 'standard' ? 20 : 22}
                  color={selectedOrderType === 'standard' ? '#FFFFFF' : CARD_SAFFRON}
                />
              </View>
            </View>
          </TouchableOpacity>

          {/* 2. QUICK ORDER -- the same card with its two surfaces swapped:
              off-white spine, teal detail panel. */}
          <TouchableOpacity
            style={[styles.card, selectedOrderType === 'quick' && styles.cardQuickActive]}
            onPress={() => handleSelectOrderType('quick')}
            activeOpacity={0.85}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Quick Order"
          >
            <View style={styles.cardRow}>
              <View style={[styles.spine, styles.spineOffWhite]}>
                <View style={[styles.spineIcon, styles.spineIconOnOffWhite]}>
                  <Ionicons name="flash" size={30} color={CARD_SAFFRON} />
                </View>
                <Text style={[styles.spineTitle, styles.spineTitleOnOffWhite, { fontSize: titleSize }]}>
                  QUICK
                </Text>
                <Text style={[styles.spineTitle, styles.spineTitleOnOffWhite, { fontSize: titleSize }]}>
                  ORDER
                </Text>
                <View style={[styles.spineUnderline, styles.spineUnderlineOnOffWhite]} />
              </View>

              <View style={[styles.detail, styles.detailTeal]}>
                {/* "Double Rate" takes the spot "Express Processing" held
                    before; that wording moved down to the first feature row,
                    which used to say "Express queue priority". */}
                <Text style={[styles.detailLine, styles.detailLineOnTeal]}>
                  Priority Turnaround {'\u00b7'}{' '}
                  <Text style={styles.rateHighlight}>Double Rate</Text>
                </Text>
                <View style={[styles.detailDivider, styles.detailDividerOnTeal]} />
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={18} color={CARD_SAFFRON} />
                  <Text style={[styles.detailLine, styles.detailLineOnTeal]}>
                    Express Processing
                  </Text>
                </View>
                <View style={[styles.detailDivider, styles.detailDividerOnTeal]} />
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark" size={18} color={CARD_SAFFRON} />
                  <Text style={[styles.detailLine, styles.detailLineOnTeal]}>
                    Fastest turnaround for urgent items
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.stateBadgeWrap}>
              <View
                style={[
                  styles.stateBadge,
                  styles.stateBadgeOnQuick,
                  selectedOrderType === 'quick' && styles.stateBadgeActive,
                ]}
              >
                <Ionicons
                  name={selectedOrderType === 'quick' ? 'checkmark' : 'chevron-forward'}
                  size={selectedOrderType === 'quick' ? 20 : 22}
                  color={selectedOrderType === 'quick' ? '#FFFFFF' : CARD_TEAL}
                />
              </View>
            </View>

            {/*
             * THE HIGHLIGHT: a ribbon floating at the opposite corner from the
             * state circle, so it never competes with it for the same
             * few square pixels of corner.
             *
             * "2x RATE" itself never fades or changes colour -- only the glow
             * behind it does. A surcharge that is unreadable for part of
             * every cycle would defeat the point of highlighting it at all.
             * The glow does two things at once, from two independent
             * sources: it PULSES (`opacity`, an Animated value on the native
             * driver) and it CYCLES THROUGH THE RAINBOW (`backgroundColor`, a
             * plain string that changes on every `rainbowIndex` tick — see
             * the state declaration above for why this is not also
             * Animated). Two different mechanisms are exactly why the badge
             * is built as a plate over a glow rather than one animated view.
             */}
            <View style={styles.rateRibbonWrap}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.rateGlow,
                  {
                    backgroundColor: rainbowColor,
                    opacity: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.25, PULSE_PEAK],
                    }),
                  },
                ]}
              />
              <View style={styles.rateBadge}>
                <Text style={styles.rateBadgeText}>{quickMultiplier}x RATE</Text>
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
    // Down from 70. The mark is `contain`-fitted and far wider than it is
    // tall, so it stays perfectly legible at this height — and the 18px is
    // the difference between both order cards fitting and not.
    height: 52,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
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
    // sm, not lg: "Selected: Guest Laundry" is 23 characters and has to live
    // beside the back button. At lg it would ellipsise on a 360dp phone,
    // which is worse than reading it a size down — this is a status line,
    // not the page's name.
    fontSize: TYPOGRAPHY.sizes.sm,
    color: COLORS.TextSecondary,
  },
  headerTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginLeft: SPACING.sm,
  },
  // The part that actually varies gets the weight and the colour. It is the
  // half that shrinks, too, so a narrow phone trims the name rather than
  // pushing the icon or the "Selected:" label off the row.
  headerTitleStrong: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '800',
    color: COLORS.PrimaryDark,
    flexShrink: 1,
  },
  scrollContent: {
    // lg, matching the Home page's page margins — the cards are the same
    // width there, and the same width is half of being the same size.
    padding: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  cardsContainer: {
    // lg, the same channel the two laundry-type cards sit in.
    gap: SPACING.lg,
  },
  card: {
    /*
     * No backgroundColor and NO overflow:hidden here. The card's surface is
     * split between the two child panels (`spine` and `detail`) -- clipping
     * THOSE to the rounded corners is `cardRow`'s job, one level in.
     *
     * This box has to stay un-clipped: the floating state circle and rate
     * ribbon are ITS children too, poking past its top edge by design, and an
     * `overflow:hidden` here would cut their tops clean off.
     */
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 2.5,
    borderColor: CARD_SAFFRON,
    backgroundColor: COLORS.Surface,
    position: 'relative',
    ...SHADOWS.medium,
  },
  cardActive: {
    borderColor: CARD_TEAL,
    ...SHADOWS.heavy,
  },
  cardQuickActive: {
    borderColor: CARD_TEAL,
    ...SHADOWS.heavy,
  },
  // The split itself: a fixed-height row, the spine and the detail panel
  // side by side, each stretched to the row's full height.
  // The clipping boundary the outer card intentionally does not provide: the
  // panels paint corner-to-corner, so THIS is what rounds them off to match
  // the card's own corners, without touching the floating badges above it.
  cardRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
  },
  /*
   * THE SPINE -- the narrow, solid-colour column carrying the icon and the
   * two-line name. `LEFT_PANEL_FLEX` of the row's total flex units, so it is
   * always the same fraction of the card regardless of screen width.
   */
  spine: {
    flex: LEFT_PANEL_FLEX,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
    // 4, matching the inset `leftTitleSize` itself assumes when it sizes the
    // title — the two have to agree, or the arithmetic that keeps "STANDARD"
    // on one line is checking a width the layout doesn't actually give it.
    paddingHorizontal: 4,
  },
  spineTeal: {
    backgroundColor: CARD_TEAL,
  },
  spineOffWhite: {
    backgroundColor: CARD_OFF_WHITE,
  },
  spineIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  spineIconOnTeal: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  // Solid teal rather than a translucent one -- a translucent plate would
  // vanish on the spine's own off-white surface.
  spineIconOnOffWhite: {
    backgroundColor: CARD_TEAL,
  },
  spineTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    /*
     * `fontSize` is set per-render from `leftTitleSize` -- it depends on how
     * wide the spine itself is, not the screen. See that function.
     *
     * ONE WORD PER LINE ON PURPOSE, via two separate <Text> elements rather
     * than one string left to wrap: "STANDARD ORDER" wrapping naturally could
     * break after either word depending on the size chosen, and the design
     * this is matching always breaks after the first. Writing it as two
     * fixed lines makes that a guarantee instead of a hope.
     *
     * NO letterSpacing: "STANDARD" is the word this column is sized around,
     * and any tracking added here is width `leftTitleSize` did not budget
     * for — the arithmetic that keeps it on one line assumes none.
     */
    fontWeight: '800',
    textAlign: 'center',
  },
  spineTitleOnTeal: {
    color: '#FFFFFF',
  },
  spineTitleOnOffWhite: {
    color: CARD_TEAL,
  },
  spineUnderline: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginTop: SPACING.xs,
  },
  spineUnderlineOnTeal: {
    backgroundColor: CARD_SAFFRON,
  },
  spineUnderlineOnOffWhite: {
    backgroundColor: CARD_SAFFRON,
  },
  /*
   * THE DETAIL PANEL -- the wide column carrying the rate line and the two
   * feature rows, in the SURFACE THE SPINE DID NOT USE. `RIGHT_PANEL_FLEX`
   * of the row's total flex units.
   */
  detail: {
    flex: RIGHT_PANEL_FLEX,
    justifyContent: 'center',
    // sm+xs, not md: the rate line can run to two lines on a narrow phone,
    // and that is the height this card needs back to still fit beside its
    // sibling without scrolling.
    paddingVertical: SPACING.sm + SPACING.xs,
    paddingHorizontal: SPACING.md,
    // The seam between the two panels: a hairline in the card's own saffron,
    // which reads clearly against both surfaces rather than needing a
    // different colour for each pairing.
    borderLeftWidth: 1.5,
    borderLeftColor: CARD_SAFFRON,
  },
  detailOffWhite: {
    backgroundColor: CARD_OFF_WHITE,
  },
  detailTeal: {
    backgroundColor: CARD_TEAL,
  },
  detailLine: {
    fontFamily: TYPOGRAPHY.fontFamily,
    // base (16), not the small caption size the stacked layout used -- in
    // this design the rate line and the two features are all the same
    // weight of statement, matching the reference.
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: '600',
    flexShrink: 1,
  },
  detailLineOnOffWhite: {
    color: CARD_TEAL,
  },
  detailLineOnTeal: {
    color: '#FFFFFF',
  },
  /*
   * "Regular Rate" and "Double Rate" -- highlighted the way the standalone
   * "2x RATE" ribbon already is: bold weight, dark ink on a saffron plate.
   * ONE style, used on both surfaces, because saffron reads clearly against
   * both the off-white and the teal panel -- there is nothing here that
   * actually needs to differ between them.
   *
   * No `borderRadius`: a nested <Text>'s background does not clip to a
   * border radius consistently across platforms, so this is a plain
   * rectangle "highlighter" mark rather than a pill.
   *
   * NEITHER copy blinks. The rainbow-cycling ribbon is what makes Quick
   * Order the option that visibly demands attention; this is a calmer,
   * permanent emphasis that both cards get equally, so Standard Order is not
   * left looking unfinished beside it.
   */
  rateHighlight: {
    backgroundColor: CARD_SAFFRON,
    color: '#1B3B36',
    fontWeight: '900',
    paddingHorizontal: 4,
  },
  detailDivider: {
    height: 1,
    // xs, not sm: the rule reads just as clearly with less air around it.
    marginVertical: SPACING.xs,
  },
  detailDividerOnOffWhite: {
    backgroundColor: 'rgba(61, 111, 115, 0.16)',
  },
  detailDividerOnTeal: {
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  /*
   * THE FLOATING STATE CIRCLE -- pinned to the top-RIGHT corner of the card,
   * poking slightly past its top edge. One fixed appearance on both cards
   * (an off-white plate, a saffron ring) so it reads as the same control
   * whichever way the spine/detail colours are flipped underneath it.
   */
  stateBadgeWrap: {
    position: 'absolute',
    top: -18,
    right: 14,
  },
  stateBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.Surface,
    borderWidth: 2,
    borderColor: CARD_SAFFRON,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.light,
  },
  // No visual difference from `stateBadge` today -- kept as its own style so
  // the Quick card's circle can be retinted independently if the two cards'
  // corner accents ever need to differ.
  stateBadgeOnQuick: {},
  // Selected: filled solid rather than outlined, the clearest way to mark
  // the one card that is actually chosen.
  stateBadgeActive: {
    backgroundColor: CARD_TEAL,
    borderColor: CARD_TEAL,
  },
  /*
   * THE RATE RIBBON -- floating at the top-LEFT corner, the corner the state
   * circle does not use. Only Quick Order has one; Standard Order's top-left
   * corner is left plain, which is itself part of what makes Quick Order the
   * one that visibly stands out.
   */
  rateRibbonWrap: {
    position: 'absolute',
    top: -16,
    left: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * The blinking, rainbow-cycling light: a plate 6px bigger than the badge
   * on every side, sitting behind it. `backgroundColor` is driven from
   * `rainbowColor` and `opacity` from `pulse` at the call site -- two
   * independent animations layered on this one element.
   *
   * Inset rather than scaled, so its footprint is fixed regardless of how
   * bright the current step of the animation is.
   */
  rateGlow: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: BORDER_RADIUS.md + 6,
  },
  rateBadge: {
    backgroundColor: CARD_SAFFRON,
    paddingHorizontal: SPACING.sm + SPACING.xs,
    paddingVertical: 7,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: CARD_TEAL,
    ...SHADOWS.medium,
  },
  rateBadgeText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    color: '#1B3B36',
    // xl (20): the surcharge is the one thing about Quick Order nobody
    // should miss, so it is the single largest piece of type on either card.
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: '900',
    letterSpacing: 0.5,
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

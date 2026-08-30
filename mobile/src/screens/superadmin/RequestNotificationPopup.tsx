import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../constants/theme';
import { RequestAlert } from '../../services/requestNotifications';

/**
 * THE NEW-REQUEST TOAST.
 *
 * A messenger-style card that slides in from the top when a request arrives:
 * the section it belongs to, who it is from, a tap to open that section, and a
 * close button.
 *
 * IT IS AN OVERLAY, NOT PART OF THE PAGE. Absolutely positioned above the
 * scroll view, so nothing on the dashboard reflows when one appears or leaves
 * — the grid, the chart and the summary stay exactly where they were.
 *
 * ONE CARD PER TYPE. Business, Rider and Sorter each produce their own alert
 * and their own card; they stack rather than merge, so a Rider request can
 * never be read as a Business one.
 *
 * TAPPING OPENS, IT DOES NOT DECIDE. The press navigates to that section and
 * nothing else — no approve, no reject, no write of any kind. Closing is the
 * same: it dismisses the card and leaves the request exactly as it was.
 */

interface Props {
  alerts: RequestAlert[];
  /** Open this section. The host also marks it read. */
  onOpen: (alert: RequestAlert) => void;
  /** Dismiss one card. The request is untouched. */
  onDismiss: (alert: RequestAlert) => void;
}

export default function RequestNotificationPopup({ alerts, onOpen, onDismiss }: Props) {
  if (alerts.length === 0) return null;

  return (
    // `pointerEvents="box-none"` so the strip itself is transparent to
    // touches and only the cards are tappable — the dashboard underneath
    // stays usable either side of them.
    <View style={styles.layer} pointerEvents="box-none">
      {alerts.map((alert) => (
        <NotificationCard
          key={alert.type}
          alert={alert}
          onOpen={() => onOpen(alert)}
          onDismiss={() => onDismiss(alert)}
        />
      ))}
    </View>
  );
}

function NotificationCard({
  alert, onOpen, onDismiss,
}: {
  alert: RequestAlert;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  // Slides down and fades in once, on the native driver so it stays smooth
  // while the dashboard is still finishing its own fetches.
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });

  const who = alert.latest?.subject_name?.trim();
  const body = alert.count > 1
    ? `${alert.count} new requests are waiting for a decision.`
    : who
      ? `${who} is waiting for a decision.`
      : `A new ${alert.label.toLowerCase()} has been received.`;

  return (
    <Animated.View style={[styles.card, { opacity: enter, transform: [{ translateY }] }]}>
      <TouchableOpacity
        style={styles.pressable}
        onPress={onOpen}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`New ${alert.label}. ${body} Tap to open.`}
      >
        <View style={styles.iconBox}>
          <Ionicons name={alert.icon as any} size={18} color={COLORS.Primary} />
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>New {alert.label}</Text>
            {alert.count > 1 && (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{alert.count}</Text>
              </View>
            )}
          </View>
          <Text style={styles.message} numberOfLines={2}>{body}</Text>
        </View>
      </TouchableOpacity>

      {/* Its own hit area, outside the card's press target, so dismissing
          cannot navigate by accident. */}
      <TouchableOpacity
        style={styles.close}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`Dismiss the ${alert.label} notification`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={16} color={COLORS.TextSecondary} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.md,
    right: SPACING.md,
    // Above the dashboard's own content, below any modal (which RN renders in
    // its own window anyway).
    zIndex: 20,
    elevation: 20,
    gap: SPACING.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.Surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.Border,
    paddingRight: SPACING.xs,
    // A little more lift than a page card: it is floating over the content.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingLeft: SPACING.sm,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  title: {
    flexShrink: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '700',
    color: COLORS.TextPrimary,
  },
  countPill: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: COLORS.Error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.Surface,
  },
  message: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.TextSecondary,
    marginTop: 1,
  },
  close: { padding: SPACING.sm },
});

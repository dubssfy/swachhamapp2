import { createNavigationContainerRef } from '@react-navigation/native';
import { getNotifications } from './expoNotifications';

/**
 * TAPPING A NOTIFICATION OPENS THE ORDER IT IS ABOUT.
 *
 * ============================================================
 * WHAT THE SERVER SENDS, AND WHY IT IS ENOUGH
 * ============================================================
 *
 * Every order notification now carries a structured data payload
 * (`orderNotification.service` on the backend):
 *
 *     orderId           which order
 *     orderNumber       what to put in the header while it loads
 *     notificationType  PICKUP_SCHEDULED | RIDER_ACCEPTED_PICKUP | ...
 *     recipientType     CUSTOMER | BUSINESS
 *
 * `recipientType` is what decides the route: a customer's orders live on
 * `CustomerOrderTracking` and a hotel's on `BusinessOrderTrackingScreen`, and
 * the two stacks are not interchangeable. It is taken from the PAYLOAD rather
 * than from the signed-in role because the payload describes the order the
 * notification is about, and the two cannot disagree — the server resolved
 * the recipient from that order.
 *
 * `notificationType` is deliberately NOT branched on. Every one of these is
 * about the same thing — this order — and the tracking screen shows the
 * assigned pickup, the rider's progress and the status ladder. A per-type
 * destination would be three routes that all had to be right, to arrive in
 * the same place.
 *
 * ============================================================
 * EVERY STEP IS ALLOWED TO DO NOTHING
 * ============================================================
 *
 * The same rule `pushRegistration` follows. A notification tapped before the
 * navigator has mounted, a payload from an older server with no `orderId`, a
 * build where the notifications module is unavailable: each means "no
 * navigation", and none of them may throw into a cold start. The notification
 * has already been read by then — opening the app at its usual screen is a
 * mild disappointment, a crash on launch is not.
 */

/**
 * The navigator, reachable from outside React.
 *
 * A notification response arrives from the OS, not from a component, so there
 * is no `navigation` prop to use. This ref is the supported way to reach the
 * navigator from such a callback.
 */
export const navigationRef = createNavigationContainerRef<any>();

/** The payload shape the backend sends. Every field may be absent. */
interface OrderNotificationData {
  orderId?: string;
  orderNumber?: string;
  notificationType?: string;
  recipientType?: string;
}

/**
 * Sends the navigator to the order a notification is about.
 *
 * Exported for the cold-start path as well as the listener, because the two
 * have to agree: a notification tapped while the app was closed and one
 * tapped while it was open must land on the same screen.
 */
export function openOrderFromNotification(data: OrderNotificationData | null | undefined): void {
  const orderId = String(data?.orderId ?? '').trim();
  if (!orderId) return;
  if (!navigationRef.isReady()) return;

  const params = { orderId, orderNumber: data?.orderNumber ?? '' };

  try {
    if (String(data?.recipientType) === 'BUSINESS') {
      navigationRef.navigate('BusinessOrderTrackingScreen', params);
    } else {
      navigationRef.navigate('CustomerOrderTracking', params);
    }
  } catch {
    /*
     * The route is not in the stack this session is showing — a signed-out
     * app, or a role whose navigator has neither screen. Nothing to do: the
     * app is open, which is most of what the tap asked for.
     */
  }
}

/**
 * Starts listening for taps. Returns the function that stops listening.
 *
 * TWO PATHS, BOTH NEEDED:
 *
 *   the LISTENER      a tap while the app is running or backgrounded.
 *
 *   the LAST RESPONSE a tap that LAUNCHED the app. The listener is attached
 *                     after that has already happened, so without this the
 *                     cold-start tap — which is the common one, because the
 *                     app is usually closed when a notification arrives —
 *                     would open the app and ignore where it was asked to go.
 */
export function startNotificationRouting(): () => void {
  const Notifications = getNotifications();
  if (!Notifications) return () => {};

  let cancelled = false;

  // The tap that launched us, if there was one.
  Notifications.getLastNotificationResponseAsync?.()
    .then((response: any) => {
      if (cancelled || !response) return;
      openOrderFromNotification(response?.notification?.request?.content?.data);
    })
    .catch(() => {
      // No launch notification, or the module cannot answer. Either way there
      // is nowhere to go.
    });

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response: any) => {
      openOrderFromNotification(response?.notification?.request?.content?.data);
    }
  );

  return () => {
    cancelled = true;
    try {
      subscription?.remove?.();
    } catch {
      // Already gone.
    }
  };
}

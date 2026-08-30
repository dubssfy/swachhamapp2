// Swachham App - Order Status Constants

export interface OrderStatusDef {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export const ORDER_STATUSES: OrderStatusDef[] = [
  {
    key: 'ORDER_PLACED',
    label: 'Order Placed',
    description: 'Your order has been successfully placed',
    icon: 'receipt',
    color: '#3B82F6',
  },
  {
    key: 'ORDER_CONFIRMED',
    label: 'Order Confirmed',
    description: 'We have confirmed your order and are preparing for pickup',
    icon: 'check-circle',
    color: '#16A34A',
  },
  {
    key: 'PICKUP_SCHEDULED',
    label: 'Pickup Scheduled',
    description: 'Pickup has been scheduled for the selected time slot',
    icon: 'event',
    color: '#D97706',
  },
  {
    key: 'PICKUP_AGENT_ASSIGNED',
    label: 'Agent Assigned',
    description: 'A pickup agent has been assigned to collect your clothes',
    icon: 'person',
    color: '#D97706',
  },
  {
    key: 'PICKUP_IN_PROGRESS',
    label: 'Pickup In Progress',
    description: 'Our agent is on the way to pick up your laundry',
    icon: 'directions-bike',
    color: '#EA580C',
  },
  {
    key: 'PICKED_UP',
    label: 'Picked Up',
    description: 'Your laundry has been picked up and is heading to our facility',
    icon: 'local-shipping',
    color: '#16A34A',
  },
  {
    key: 'IN_PRODUCTION',
    label: 'In Production',
    description: 'Your laundry is being processed at our facility',
    icon: 'local-laundry-service',
    color: '#7C3AED',
  },
  {
    key: 'WASHING',
    label: 'Washing',
    description: 'Your clothes are being washed with premium detergents',
    icon: 'water',
    color: '#7C3AED',
  },
  {
    key: 'DRYING',
    label: 'Drying',
    description: 'Your clothes are being professionally dried',
    icon: 'air',
    color: '#7C3AED',
  },
  {
    key: 'IRONING',
    label: 'Ironing',
    description: 'Your clothes are being carefully ironed and pressed',
    icon: 'iron',
    color: '#7C3AED',
  },
  {
    key: 'QUALITY_CHECK',
    label: 'Quality Check',
    description: 'Final quality inspection before packing',
    icon: 'verified',
    color: '#D97706',
  },
  {
    key: 'READY_FOR_DELIVERY',
    label: 'Ready for Delivery',
    description: 'Your laundry is packed and ready to be delivered',
    icon: 'inventory',
    color: '#15803D',
  },
  {
    key: 'DELIVERY_SCHEDULED',
    label: 'Delivery Scheduled',
    description: 'Delivery has been scheduled for the selected time slot',
    icon: 'schedule',
    color: '#059669',
  },
  {
    key: 'DELIVERY_IN_PROGRESS',
    label: 'Out for Delivery',
    description: 'Our delivery agent is on the way to your location',
    icon: 'local-shipping',
    color: '#EA580C',
  },
  {
    key: 'DELIVERED',
    label: 'Delivered',
    description: 'Your laundry has been delivered successfully',
    icon: 'done-all',
    color: '#15803D',
  },
  {
    key: 'COMPLETED',
    label: 'Completed',
    description: 'Order completed successfully. Thank you for using Swachham!',
    icon: 'star',
    color: '#166534',
  },
  {
    key: 'CANCELLED',
    label: 'Cancelled',
    description: 'This order has been cancelled',
    icon: 'cancel',
    color: '#DC2626',
  },
];

export const PRODUCTION_STATUSES: OrderStatusDef[] = [
  {
    key: 'RECEIVED',
    label: 'Received at Facility',
    description: 'Laundry received and tagged at our facility',
    icon: 'inbox',
    color: '#3B82F6',
  },
  {
    key: 'PRE_TREATMENT',
    label: 'Pre-Treatment',
    description: 'Applying pre-treatment for stains and special care',
    icon: 'science',
    color: '#7C3AED',
  },
  {
    key: 'WASHING',
    label: 'Washing',
    description: 'Being washed with premium eco-friendly detergents',
    icon: 'water',
    color: '#2563EB',
  },
  {
    key: 'DRYING',
    label: 'Drying',
    description: 'Professional drying process underway',
    icon: 'air',
    color: '#0891B2',
  },
  {
    key: 'IRONING',
    label: 'Ironing & Folding',
    description: 'Carefully ironed, pressed and folded',
    icon: 'iron',
    color: '#D97706',
  },
  {
    key: 'QUALITY_CHECK',
    label: 'Quality Inspection',
    description: 'Thorough quality check before packing',
    icon: 'verified',
    color: '#059669',
  },
  {
    key: 'PACKED',
    label: 'Packed',
    description: 'Safely packed and ready for delivery',
    icon: 'inventory',
    color: '#16A34A',
  },
];

export const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'DELIVERED'];

export const ACTIVE_STATUSES = [
  'ORDER_PLACED',
  'ORDER_CONFIRMED',
  'PICKUP_SCHEDULED',
  'PICKUP_AGENT_ASSIGNED',
  'PICKUP_IN_PROGRESS',
  'PICKED_UP',
  'IN_PRODUCTION',
  'WASHING',
  'DRYING',
  'IRONING',
  'QUALITY_CHECK',
  'READY_FOR_DELIVERY',
  'DELIVERY_SCHEDULED',
  'DELIVERY_IN_PROGRESS',
];

export function getStatusIndex(status: string): number {
  return ORDER_STATUSES.findIndex((s) => s.key === status);
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function getStatusDef(status: string): OrderStatusDef | undefined {
  return ORDER_STATUSES.find((s) => s.key === status);
}

export function getProductionStatusDef(status: string): OrderStatusDef | undefined {
  return PRODUCTION_STATUSES.find((s) => s.key === status);
}

export function canCancelOrder(status: string): boolean {
  return ['ORDER_PLACED', 'ORDER_CONFIRMED', 'PICKUP_SCHEDULED'].includes(status);
}

/* ===================================================================
 * THE CUSTOMER TRACKER
 *
 * WHY THIS SECTION EXISTS. Everything above predates the current schema and
 * had drifted from it: `ORDER_STATUSES` has keys the database cannot hold
 * (ORDER_CONFIRMED, IN_PRODUCTION, DELIVERY_IN_PROGRESS) and is missing ones
 * it uses every day (OUT_FOR_DELIVERY, RECEIVED_AT_FACILITY, SORTING,
 * PICKUP_ASSIGNED, PARTIALLY_COMPLETED). Nothing imported the file, so the
 * drift had never shown up.
 *
 * The `orders.status` ENUM is the authority:
 *
 *   ORDER_PLACED, PICKUP_SCHEDULED, PICKUP_ASSIGNED, PICKED_UP,
 *   RECEIVED_AT_FACILITY, SORTING, WASHING, DRYING, IRONING, QUALITY_CHECK,
 *   READY_FOR_DELIVERY, DELIVERY_ASSIGNED, OUT_FOR_DELIVERY, DELIVERED,
 *   COMPLETED, CANCELLED, PARTIALLY_COMPLETED
 *
 * The wording above is REUSED wherever a key matches, so the app keeps saying
 * "Picked Up" and "Ready for Delivery" exactly as it always has. Nothing
 * above is renamed or removed.
 * =================================================================== */

/** Every status the database can actually hold, in the order it happens. */
export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  /* Booked, and waiting on a Manager to accept it. Migration 053. */
  PENDING_APPROVAL: 'Awaiting Confirmation',
  ORDER_PLACED: 'Order Placed',
  PICKUP_SCHEDULED: 'Pickup Scheduled',
  PICKUP_ASSIGNED: 'Agent Assigned',
  PICKED_UP: 'Picked Up',
  RECEIVED_AT_FACILITY: 'Received at Facility',
  SORTING: 'Sorting',
  WASHING: 'Washing',
  DRYING: 'Drying',
  IRONING: 'Ironing',
  QUALITY_CHECK: 'Quality Check',
  READY_FOR_DELIVERY: 'Ready for Delivery',
  DELIVERY_ASSIGNED: 'Delivery Assigned',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially Completed',
  CANCELLED: 'Cancelled',
};

/**
 * What a status is called, for any of them.
 *
 * An unknown value is spelled out rather than dropped: a status added to the
 * ENUM later should read as "Awaiting Pickup", not as a blank line.
 */
export function customerStatusLabel(status: unknown): string {
  const key = String(status ?? '');
  return CUSTOMER_STATUS_LABELS[key]
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const CANCELLED_STATUS = 'CANCELLED';

export function isCancelledStatus(status: unknown): boolean {
  return String(status ?? '') === CANCELLED_STATUS;
}

/**
 * THE STAGES THE CUSTOMER SEES.
 *
 * Seventeen statuses is an operations vocabulary, not a customer one — nobody
 * ordering a wash needs Sorting and Drying as separate milestones. Each stage
 * therefore collects the statuses that mean the same thing to the person
 * waiting, and the tracker highlights the stage holding the CURRENT status.
 *
 * CANCELLED IS NOT A STAGE. It is not a point along this line — it ends it —
 * so the tracker replaces the ladder rather than lighting a step on it.
 */
export interface CustomerStage {
  key: string;
  label: string;
  icon: string;
  /** The `orders.status` values that put an order at this stage. */
  statuses: string[];
}

export const CUSTOMER_STAGES: CustomerStage[] = [
  /*
   * A booking waits here until a Manager accepts it. Its own rung rather
   * than folded into Order Placed: the approval step exists precisely
   * because the two are different states, and showing "Order Placed" for an
   * order nobody has accepted would state something untrue.
   */
  {
    key: 'PENDING',
    label: 'Awaiting Confirmation',
    icon: 'hourglass-outline',
    statuses: ['PENDING_APPROVAL'],
  },
  {
    key: 'PLACED',
    label: 'Order Placed',
    icon: 'receipt-outline',
    statuses: ['ORDER_PLACED'],
  },
  {
    key: 'SCHEDULED',
    label: 'Pickup Scheduled',
    icon: 'calendar-outline',
    statuses: ['PICKUP_SCHEDULED', 'PICKUP_ASSIGNED'],
  },
  {
    key: 'PICKED_UP',
    label: 'Picked Up',
    icon: 'bicycle-outline',
    statuses: ['PICKED_UP', 'RECEIVED_AT_FACILITY'],
  },
  {
    key: 'IN_PROCESS',
    label: 'In Process',
    icon: 'water-outline',
    statuses: ['SORTING', 'WASHING', 'DRYING', 'IRONING', 'QUALITY_CHECK'],
  },
  {
    key: 'READY',
    label: 'Ready for Delivery',
    icon: 'cube-outline',
    statuses: ['READY_FOR_DELIVERY', 'DELIVERY_ASSIGNED'],
  },
  {
    key: 'OUT_FOR_DELIVERY',
    label: 'Out for Delivery',
    icon: 'car-outline',
    statuses: ['OUT_FOR_DELIVERY'],
  },
  {
    key: 'DELIVERED',
    label: 'Delivered',
    icon: 'checkmark-done-outline',
    statuses: ['DELIVERED', 'COMPLETED', 'PARTIALLY_COMPLETED'],
  },
];

/**
 * Which stage an order is at, as an index into `CUSTOMER_STAGES`.
 *
 * -1 for a cancelled order and for anything unrecognised, so a caller that
 * lights "every stage up to n" cannot light the whole ladder for a status it
 * did not understand.
 */
export function customerStageIndex(status: unknown): number {
  const key = String(status ?? '');
  if (key === CANCELLED_STATUS) return -1;
  return CUSTOMER_STAGES.findIndex((stage) => stage.statuses.includes(key));
}

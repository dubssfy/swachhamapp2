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

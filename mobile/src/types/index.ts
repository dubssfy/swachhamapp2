// Swachham App - TypeScript Type Definitions

export interface User {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: 'customer' | 'business' | 'admin' | 'driver';
  avatar?: string;
  isVerified?: boolean;
  mobileVerified?: boolean;
  createdAt?: string;
  updatedAt?: string;
  defaultAddressId?: string;
  addresses?: Address[];
  notificationPreferences?: NotificationPreferences;
}

export interface CustomerProfile {
  id: string;
  userId: string;
  username: string;
  totalOrders: number;
  loyaltyPoints: number;
  walletBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAddress {
  id: string;
  userId: string;
  tag: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessImage {
  id: string;
  businessId: string;
  url: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface Business {
  id: string;
  ownerId: string;
  businessName: string;
  registrationNumber: string;
  taxId?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  website?: string;
  description?: string;
  operatingHours?: string;
  status: 'pending' | 'active' | 'suspended' | 'closed';
  rating: number;
  totalReviews: number;
  images?: BusinessImage[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  orderUpdates: boolean;
  promotions: boolean;
}

export interface Address {
  id: string;
  userId?: string;
  label: string; // 'Home' | 'Work' | 'Other'
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  landmark?: string;
  isDefault: boolean;
  latitude?: number;
  longitude?: number;
  createdAt?: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  description?: string;
  iconName?: string;
  iconEmoji?: string;
  color: string;
  imageUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
  serviceCount?: number;
}

export interface Service {
  id: string;
  name: string;
  description?: string;
  categoryId: string;
  category?: ServiceCategory;
  unit: string; // 'per piece' | 'per kg' | etc.
  basePrice: number;
  discountedPrice: number;
  discountPercent?: number;
  imageUrl?: string;
  iconEmoji?: string;
  isActive?: boolean;
  isPopular?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
  minQuantity?: number;
  maxQuantity?: number;
  estimatedDays?: number;
  tags?: string[];
}

export interface CartItem {
  id: string;
  cartId?: string;
  serviceId: string;
  service: Service;
  quantity: number;
  basePrice: number;
  discountedPrice: number;
  totalPrice: number;
  addedAt?: string;
}

export interface Cart {
  id: string;
  userId: string;
  items: CartItem[];
  subtotal: number;
  deliveryCharge: number;
  tax: number;
  couponCode?: string;
  couponDiscount: number;
  total: number;
  itemCount: number;
  freeDeliveryThreshold?: number;
  updatedAt?: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  serviceId: string;
  service: Service;
  quantity: number;
  basePrice: number;
  discountedPrice: number;
  totalPrice: number;
}

export interface OrderStatusHistory {
  id: string;
  orderId: string;
  status: string;
  note?: string;
  updatedBy?: string;
  createdAt: string;
}

export interface ProductionStatusHistory {
  id: string;
  orderId: string;
  status: string;
  note?: string;
  createdAt: string;
}

export interface PickupSlot {
  date: string;
  timeSlot: string; // 'morning' | 'afternoon' | 'evening'
  timeRange: string; // '8 AM - 11 AM'
}

export interface DeliverySlot {
  date: string;
  timeSlot: string;
  timeRange: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  items: OrderItem[];
  addressId: string;
  address?: Address;
  pickupSlot: PickupSlot;
  deliverySlot: DeliverySlot;
  subtotal: number;
  deliveryCharge: number;
  tax: number;
  couponCode?: string;
  couponDiscount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  itemCount: number;
  specialInstructions?: string;
  statusHistory?: OrderStatusHistory[];
  productionStatusHistory?: ProductionStatusHistory[];
  estimatedDelivery?: string;
  isCancellable?: boolean;
  cancelReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProductionOrder {
  id: string;
  orderId: string;
  currentStatus: string;
  startedAt?: string;
  completedAt?: string;
  statusHistory: ProductionStatusHistory[];
}

export interface Pickup {
  id: string;
  orderId: string;
  agentId?: string;
  agentName?: string;
  agentMobile?: string;
  agentPhoto?: string;
  scheduledDate: string;
  scheduledTimeSlot: string;
  scheduledTimeRange: string;
  actualPickupTime?: string;
  status: string;
  latitude?: number;
  longitude?: number;
}

export interface Delivery {
  id: string;
  orderId: string;
  agentId?: string;
  agentName?: string;
  agentMobile?: string;
  agentPhoto?: string;
  scheduledDate: string;
  scheduledTimeSlot: string;
  scheduledTimeRange: string;
  actualDeliveryTime?: string;
  status: string;
  latitude?: number;
  longitude?: number;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'order' | 'promo' | 'system' | 'payment';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface Coupon {
  code: string;
  type: 'percentage' | 'flat';
  value: number;
  minOrderValue?: number;
  maxDiscount?: number;
  description?: string;
  expiresAt?: string;
  isValid: boolean;
  discountAmount: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
  statusCode?: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  message?: string;
}

export interface AuthState {
  user: User | null;
  userType: 'customer' | 'business' | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface CartState {
  items: CartItem[];
  subtotal: number;
  deliveryCharge: number;
  couponDiscount: number;
  couponCode: string | null;
  tax: number;
  total: number;
  itemCount: number;
  isLoading: boolean;
  freeDeliveryThreshold: number;
}

export interface TrackingData {
  order: Order;
  currentStatus: string;
  statusHistory: OrderStatusHistory[];
  productionStatus?: string;
  productionStatusHistory?: ProductionStatusHistory[];
  pickup?: Pickup;
  delivery?: Delivery;
  estimatedDelivery?: string;
  lastUpdated: string;
}

export interface TimeSlot {
  id: string;
  label: string;
  timeRange: string;
  available: boolean;
}

export interface CreateOrderPayload {
  addressId: string;
  pickupDate: string;
  pickupTimeSlot: string;
  deliveryDate: string;
  deliveryTimeSlot: string;
  paymentMethod: string;
  couponCode?: string;
  specialInstructions?: string;
}

export interface LoginPayload {
  email?: string;
  mobile?: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  mobile: string;
  password: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface BusinessRegisterPayload {
  customerType: string;
  otherTypeSpecify?: string;
  establishmentName: string;
  establishmentAddress: string;
  gstNumber?: string;
  panNumber?: string;
  website?: string;
  contactPersonName: string;
  designation?: string;
  mobileNumber: string;
  whatsappNumber?: string;
  emailId: string;
  alternateContactPerson?: string;
  alternateMobileNo?: string;
  password: string;
  confirmPassword: string;
}

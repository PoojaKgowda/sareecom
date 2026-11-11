export type Role = "admin" | "customer";

export interface Address {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
}

export interface Product {
  designCode: string;
  variantCode: string;
  name: string;
  category: string;
  description: string;
  color: string;
  price: number;
  stock: number;
  imageUrl: string;
  active: boolean;
}

export interface User {
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  cart: Record<string, number>;
  wishlist: string[];
  address: Address | null;
  createdAt: string;
}

export interface OrderItem {
  variantCode: string;
  name: string;
  color: string;
  quantity: number;
  unitPrice: number;
}

export type OrderStatus = "Placed" | "Confirmed" | "Packed" | "Shipped" | "Delivered";

export interface Order {
  orderId: string;
  email: string;
  items: OrderItem[];
  total: number;
  address: Address;
  status: OrderStatus;
  carrier: string;
  trackingNumber: string;
  createdAt: string;
}

export interface SessionUser {
  email: string;
  role: Role;
  name: string;
}

import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

export const addressSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(24),
  street: z.string().trim().min(3).max(240),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(3).max(20),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(5).max(1500),
  color: z.string().trim().min(2).max(60),
  price: z.coerce.number().positive().max(10_000_000),
  stock: z.coerce.number().int().min(0).max(100_000),
  imageUrl: z.string().trim().url().max(1000).or(z.literal("")).default(""),
});

export const cartSchema = z.object({
  variantCode: z.string().trim().min(3).max(40),
  quantity: z.coerce.number().int().min(1).max(100),
});

export const orderStatusSchema = z.object({
  status: z.enum(["Placed", "Confirmed", "Packed", "Shipped", "Delivered"]),
  carrier: z.string().trim().max(100).default(""),
  trackingNumber: z.string().trim().max(160).default(""),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
});

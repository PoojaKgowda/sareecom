import { describe, expect, it } from "vitest";
import { addressSchema, cartSchema, credentialsSchema, productSchema } from "./schemas.js";

describe("store input validation", () => {
  it("normalizes emails and rejects weak passwords", () => {
    expect(credentialsSchema.parse({ email: "  Shopper@Example.COM ", password: "long-enough-password" }).email)
      .toBe("shopper@example.com");
    expect(() => credentialsSchema.parse({ email: "shopper@example.com", password: "short" })).toThrow();
  });

  it("requires a non-negative whole number for stock", () => {
    expect(productSchema.safeParse({
      name: "Silk Saree",
      category: "Silk",
      description: "Handwoven silk saree.",
      color: "Ruby",
      price: 2500,
      stock: 2,
      imageUrl: "",
    }).success).toBe(true);
    expect(productSchema.safeParse({
      name: "Silk Saree",
      category: "Silk",
      description: "Handwoven silk saree.",
      color: "Ruby",
      price: 2500,
      stock: -1,
      imageUrl: "",
    }).success).toBe(false);
  });

  it("validates delivery address and quantity bounds", () => {
    expect(addressSchema.safeParse({
      fullName: "A Customer",
      phone: "9876543210",
      street: "12 Market Road",
      city: "Chennai",
      region: "Tamil Nadu",
      postalCode: "600001",
    }).success).toBe(true);
    expect(cartSchema.safeParse({ variantCode: "LAN109-1", quantity: 0 }).success).toBe(false);
  });
});

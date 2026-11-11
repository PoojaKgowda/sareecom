import {
  readRows,
  appendRow,
  updateRow,
  createProductRow,
  createVariantRow,
  sheetReady as checkSheetsConfig,
} from "./sheets.js";
import type { Address, Order, OrderItem, Product, Role, User } from "./types.js";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function listProducts(includeInactive = false): Promise<Product[]> {
  const rows = await readRows("Products");
  return rows
    .map((row) => ({
      designCode: row[0],
      variantCode: row[1],
      name: row[2],
      category: row[3],
      description: row[4],
      color: row[5],
      price: Number(row[6]),
      stock: Number(row[7]),
      imageUrl: row[8],
      active: row[9] !== "false",
    }))
    .filter((product) => includeInactive || product.active);
}

export async function getProductRows(): Promise<Array<{ product: Product; sheetRow: number }>> {
  const rows = await readRows("Products");
  return rows.map((row, index) => ({
    product: {
      designCode: row[0],
      variantCode: row[1],
      name: row[2],
      category: row[3],
      description: row[4],
      color: row[5],
      price: Number(row[6]),
      stock: Number(row[7]),
      imageUrl: row[8],
      active: row[9] !== "false",
    },
    sheetRow: index + 2,
  }));
}

export async function createProduct(product: Omit<Product, "designCode" | "variantCode" | "active">): Promise<Product> {
  return createProductRow(product, process.env.SKU_PREFIX || "LAN");
}

export async function createVariant(
  designCode: string,
  variant: Pick<Product, "color" | "price" | "stock" | "imageUrl">,
): Promise<Product> {
  return createVariantRow(designCode, variant);
}

function productToRow(product: Product): string[] {
  return [
    product.designCode,
    product.variantCode,
    product.name,
    product.category,
    product.description,
    product.color,
    String(product.price),
    String(product.stock),
    product.imageUrl,
    String(product.active),
  ];
}

export async function setProductStock(variantCode: string, stock: number): Promise<Product | undefined> {
  const rows = await getProductRows();
  const item = rows.find(({ product }) => product.variantCode === variantCode);
  if (!item) return undefined;
  item.product.stock = stock;
  const row = productToRow(item.product);
  await updateRow("Products", item.sheetRow, row);
  return item.product;
}

export async function addCategory(name: string): Promise<string> {
  const current = await readRows("Categories");
  if (current.some(([existing]) => existing.toLowerCase() === name.toLowerCase())) {
    throw new Error("That category already exists.");
  }
  await appendRow("Categories", [name]);
  return name;
}

export async function listCategories(): Promise<string[]> {
  const categories = (await readRows("Categories")).map(([name]) => name).filter(Boolean);
  const products = await listProducts(true);
  return [...new Set([...categories, ...products.map((product) => product.category)])].sort((a, b) => a.localeCompare(b));
}

export async function findUser(email: string): Promise<{ user: User; sheetRow: number } | undefined> {
  const rows = await readRows("Users");
  const index = rows.findIndex(([storedEmail]) => storedEmail === email.toLowerCase());
  if (index < 0) return undefined;
  const row = rows[index];
  return {
    user: {
      email: row[0],
      passwordHash: row[1],
      role: row[2] as Role,
      name: row[3],
      cart: parseJson<Record<string, number>>(row[4], {}),
      wishlist: parseJson<string[]>(row[5], []),
      address: parseJson<Address | null>(row[6], null),
      createdAt: row[7],
    },
    sheetRow: index + 2,
  };
}

export async function createUser(user: User): Promise<void> {
  await appendRow("Users", userToRow(user));
}

export async function saveUser(user: User, sheetRow: number): Promise<void> {
  await updateRow("Users", sheetRow, userToRow(user));
}

export function userToRow(user: User): string[] {
  return [
    user.email,
    user.passwordHash,
    user.role,
    user.name,
    JSON.stringify(user.cart),
    JSON.stringify(user.wishlist),
    JSON.stringify(user.address),
    user.createdAt,
  ];
}

export async function listOrders(): Promise<Array<Order & { sheetRow: number }>> {
  const rows = await readRows("Orders");
  return rows.map((row, index) => ({
    orderId: row[0],
    email: row[1],
    items: parseJson<OrderItem[]>(row[2], []),
    total: Number(row[3]),
    address: parseJson<Address>(row[4], {
      fullName: "",
      phone: "",
      street: "",
      city: "",
      region: "",
      postalCode: "",
    }),
    status: row[5] as Order["status"],
    carrier: row[6],
    trackingNumber: row[7],
    createdAt: row[8],
    sheetRow: index + 2,
  }));
}

export async function updateOrder(
  orderId: string,
  changes: Pick<Order, "status" | "carrier" | "trackingNumber">,
): Promise<Order | undefined> {
  const orders = await listOrders();
  const order = orders.find((item) => item.orderId === orderId);
  if (!order) return undefined;
  const updated = { ...order, ...changes };
  await updateRow("Orders", order.sheetRow, [
    updated.orderId,
    updated.email,
    JSON.stringify(updated.items),
    String(updated.total),
    JSON.stringify(updated.address),
    updated.status,
    updated.carrier,
    updated.trackingNumber,
    updated.createdAt,
  ]);
  return updated;
}

export async function sheetReady(): Promise<void> {
  checkSheetsConfig();
}

import type { Product } from "./types.js";

const tabHeaders = {
  Products: ["designCode", "variantCode", "name", "category", "description", "color", "price", "stock", "imageUrl", "active"],
  Categories: ["name"],
  Users: ["email", "passwordHash", "role", "name", "cartJson", "wishlistJson", "addressJson", "createdAt"],
  Orders: ["orderId", "email", "itemsJson", "total", "addressJson", "status", "carrier", "trackingNumber", "createdAt"],
} as const;

type Tab = keyof typeof tabHeaders;

interface AppsScriptResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function getAppsScriptConfig(): { url: string; secret: string } {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET?.trim();
  if (!url || !secret) {
    throw new Error("Set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET in your .env file.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("GOOGLE_APPS_SCRIPT_URL must be a valid deployed Apps Script web app URL.");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(parsedUrl.pathname)
  ) {
    throw new Error("GOOGLE_APPS_SCRIPT_URL must be the HTTPS deployment URL ending in /exec.");
  }
  if (secret.length < 32) {
    throw new Error("GOOGLE_APPS_SCRIPT_SECRET must be at least 32 characters long.");
  }
  return { url: parsedUrl.toString(), secret };
}

async function appsScriptRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { url, secret } = getAppsScriptConfig();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, secret, ...payload }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Could not connect to the Google Apps Script web app: ${error instanceof Error ? error.message : "network error"}`);
  }

  const text = await response.text();
  let result: AppsScriptResponse<T>;
  try {
    result = JSON.parse(text) as AppsScriptResponse<T>;
  } catch {
    throw new Error(`Google Apps Script returned an unexpected response (HTTP ${response.status}). Check the deployed web app URL and deployment access settings.`);
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Google Apps Script request failed (HTTP ${response.status}).`);
  }
  return result.data as T;
}

export async function initializeSheets(): Promise<void> {
  await appsScriptRequest<void>("initialize");
}

export async function readRows(tab: Tab): Promise<string[][]> {
  const rows = await appsScriptRequest<unknown>("readRows", { tab });
  if (!Array.isArray(rows)) throw new Error(`Google Apps Script returned invalid rows for ${tab}.`);
  return rows.map((row) => {
    if (!Array.isArray(row)) throw new Error(`Google Apps Script returned an invalid ${tab} row.`);
    return Array.from({ length: tabHeaders[tab].length }, (_, index) => String(row[index] ?? ""));
  });
}

export async function appendRow(tab: Tab, row: string[]): Promise<void> {
  await appsScriptRequest<void>("appendRow", { tab, row });
}

export async function createProductRow(
  product: Omit<Product, "designCode" | "variantCode" | "active">,
  prefix: string,
): Promise<Product> {
  return appsScriptRequest<Product>("createProduct", { product, prefix });
}

export async function createVariantRow(
  designCode: string,
  variant: Pick<Product, "color" | "price" | "stock" | "imageUrl">,
): Promise<Product> {
  return appsScriptRequest<Product>("createVariant", { designCode, variant });
}

export async function updateRow(tab: Tab, sheetRow: number, row: string[]): Promise<void> {
  await appsScriptRequest<void>("updateRow", { tab, sheetRow, row });
}

export async function createOrderAndDecrementStock(
  products: Array<{ variantCode: string; quantity: number }>,
  orderRow: string[],
  userUpdate: { sheetRow: number; row: string[] },
): Promise<void> {
  await appsScriptRequest<void>("createOrderAndDecrementStock", { products, orderRow, userUpdate });
}

export function sheetReady(): void {
  getAppsScriptConfig();
}

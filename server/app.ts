import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { ZodError } from "zod";
import { addressSchema, cartSchema, categorySchema, credentialsSchema, orderStatusSchema, productSchema } from "./schemas.js";
import { clearSessionCookie, issueSession, requireAdmin, requireAuth, setSessionCookie } from "./auth.js";
import {
  addCategory,
  createProduct,
  createVariant,
  findUser,
  getProductRows,
  listCategories,
  listOrders,
  listProducts,
  saveUser,
  setProductStock,
  updateOrder,
  userToRow,
} from "./store.js";
import { createOrderAndDecrementStock } from "./sheets.js";
import type { Order, OrderItem, Product, User } from "./types.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    },
  },
}));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

function publicUser(user: User) {
  return { email: user.email, role: user.role, name: user.name, address: user.address };
}

function pathParam(request: express.Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw Object.assign(new Error(`Invalid ${name}.`), { status: 400 });
  return value;
}

app.get("/api/health", (_request, response) => response.json({ ok: true }));

app.post(
  "/api/auth/register",
  authLimiter,
  asyncRoute(async (request, response) => {
    const input = credentialsSchema.parse(request.body);
    if (!input.name) return response.status(400).json({ error: "Please provide your name." });
    if (await findUser(input.email)) return response.status(409).json({ error: "An account with that email already exists." });
    const user: User = {
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: "customer",
      name: input.name,
      cart: {},
      wishlist: [],
      address: null,
      createdAt: new Date().toISOString(),
    };
    const token = issueSession({ email: user.email, role: user.role, name: user.name });
    const { createUser } = await import("./store.js");
    await createUser(user);
    setSessionCookie(response, token);
    response.status(201).json({ user: publicUser(user) });
  }),
);

app.post(
  "/api/auth/login",
  authLimiter,
  asyncRoute(async (request, response) => {
    const input = credentialsSchema.omit({ name: true }).parse(request.body);
    const record = await findUser(input.email);
    if (!record || !(await bcrypt.compare(input.password, record.user.passwordHash))) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    const token = issueSession({ email: record.user.email, role: record.user.role, name: record.user.name });
    setSessionCookie(response, token);
    response.json({ user: publicUser(record.user) });
  }),
);

app.post("/api/auth/logout", (_request, response) => {
  clearSessionCookie(response);
  response.status(204).end();
});

app.get(
  "/api/me",
  requireAuth,
  asyncRoute(async (request, response) => {
    const record = await findUser(request.user!.email);
    if (!record) return response.status(401).json({ error: "Account not found. Please sign in again." });
    response.json({ user: publicUser(record.user) });
  }),
);

app.put(
  "/api/me/address",
  requireAuth,
  asyncRoute(async (request, response) => {
    const address = addressSchema.parse(request.body);
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    record.user.address = address;
    await saveUser(record.user, record.sheetRow);
    response.json({ user: publicUser(record.user) });
  }),
);

app.get(
  "/api/products",
  asyncRoute(async (_request, response) => {
    response.json({ products: await listProducts() });
  }),
);

app.get(
  "/api/categories",
  asyncRoute(async (_request, response) => {
    response.json({ categories: await listCategories() });
  }),
);

app.get(
  "/api/cart",
  requireAuth,
  asyncRoute(async (request, response) => {
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    response.json({ cart: record.user.cart, wishlist: record.user.wishlist });
  }),
);

app.put(
  "/api/cart",
  requireAuth,
  asyncRoute(async (request, response) => {
    const { variantCode, quantity } = cartSchema.parse(request.body);
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    const product = (await listProducts()).find((item) => item.variantCode === variantCode);
    if (!product) return response.status(404).json({ error: "That saree is no longer available." });
    if (quantity > product.stock) {
      return response.status(409).json({ error: product.stock ? `Only ${product.stock} left in stock.` : "This saree is out of stock." });
    }
    record.user.cart[variantCode] = quantity;
    await saveUser(record.user, record.sheetRow);
    response.json({ cart: record.user.cart });
  }),
);

app.delete(
  "/api/cart/:variantCode",
  requireAuth,
  asyncRoute(async (request, response) => {
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    delete record.user.cart[pathParam(request, "variantCode")];
    await saveUser(record.user, record.sheetRow);
    response.json({ cart: record.user.cart });
  }),
);

app.put(
  "/api/wishlist/:variantCode",
  requireAuth,
  asyncRoute(async (request, response) => {
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    const variantCode = pathParam(request, "variantCode");
    const product = (await listProducts()).find((item) => item.variantCode === variantCode);
    if (!product) return response.status(404).json({ error: "That saree is no longer available." });
    record.user.wishlist = [...new Set([...record.user.wishlist, product.variantCode])];
    await saveUser(record.user, record.sheetRow);
    response.json({ wishlist: record.user.wishlist });
  }),
);

app.delete(
  "/api/wishlist/:variantCode",
  requireAuth,
  asyncRoute(async (request, response) => {
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    const variantCode = pathParam(request, "variantCode");
    record.user.wishlist = record.user.wishlist.filter((code) => code !== variantCode);
    await saveUser(record.user, record.sheetRow);
    response.json({ wishlist: record.user.wishlist });
  }),
);

let storeWriteQueue = Promise.resolve();
function withStoreWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeWriteQueue.then(operation, operation);
  storeWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

app.post(
  "/api/orders",
  requireAuth,
  asyncRoute(async (request, response) => {
    const address = addressSchema.parse(request.body);
    const record = await findUser(request.user!.email);
    if (!record) return response.status(404).json({ error: "Account not found." });
    const order = await withStoreWriteLock(async () => {
      const cart = record.user.cart;
      const entries = Object.entries(cart).filter(([, quantity]) => quantity > 0);
      if (!entries.length) throw Object.assign(new Error("Your cart is empty."), { status: 400 });
      const rows = await getProductRows();
      const items: OrderItem[] = [];
      const stockUpdates: Array<{ variantCode: string; quantity: number }> = [];
      for (const [variantCode, quantity] of entries) {
        const row = rows.find(({ product }) => product.variantCode === variantCode && product.active);
        if (!row) throw Object.assign(new Error(`Saree ${variantCode} is no longer available.`), { status: 409 });
        if (row.product.stock < quantity) {
          throw Object.assign(new Error(row.product.stock ? `Only ${row.product.stock} of ${row.product.name} (${row.product.color}) remain.` : `${row.product.name} (${row.product.color}) is out of stock.`), { status: 409 });
        }
        items.push({
          variantCode,
          name: row.product.name,
          color: row.product.color,
          quantity,
          unitPrice: row.product.price,
        });
        stockUpdates.push({ variantCode, quantity });
      }
      const created: Order = {
        orderId: `ORD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        email: record.user.email,
        items,
        total: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
        address,
        status: "Placed",
        carrier: "",
        trackingNumber: "",
        createdAt: new Date().toISOString(),
      };
      record.user.cart = {};
      record.user.address = address;
      await createOrderAndDecrementStock(
        stockUpdates,
        [
          created.orderId,
          created.email,
          JSON.stringify(created.items),
          String(created.total),
          JSON.stringify(created.address),
          created.status,
          created.carrier,
          created.trackingNumber,
          created.createdAt,
        ],
        { sheetRow: record.sheetRow, row: userToRow(record.user) },
      );
      return created;
    });
    response.status(201).json({ order });
  }),
);

app.get(
  "/api/orders",
  requireAuth,
  asyncRoute(async (request, response) => {
    const orders = await listOrders();
    response.json({
      orders: (request.user!.role === "admin" ? orders : orders.filter((order) => order.email === request.user!.email))
        .map(({ sheetRow: _sheetRow, ...order }) => order)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }),
);

app.get(
  "/api/admin/products",
  requireAuth,
  requireAdmin,
  asyncRoute(async (_request, response) => {
    response.json({ products: await listProducts(true) });
  }),
);

app.post(
  "/api/admin/products",
  requireAuth,
  requireAdmin,
  asyncRoute(async (request, response) => {
    const product = productSchema.parse(request.body) as Omit<Product, "designCode" | "variantCode" | "active">;
    response.status(201).json({ product: await withStoreWriteLock(() => createProduct(product)) });
  }),
);

app.post(
  "/api/admin/products/:designCode/variants",
  requireAuth,
  requireAdmin,
  asyncRoute(async (request, response) => {
    const input = productSchema.pick({ color: true, price: true, stock: true, imageUrl: true }).parse(request.body);
    const designCode = pathParam(request, "designCode");
    response.status(201).json({ product: await withStoreWriteLock(() => createVariant(designCode, input)) });
  }),
);

app.patch(
  "/api/admin/products/:variantCode/stock",
  requireAuth,
  requireAdmin,
  asyncRoute(async (request, response) => {
    const stock = Number(request.body?.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100_000) {
      return response.status(400).json({ error: "Stock must be a whole number between 0 and 100000." });
    }
    const variantCode = pathParam(request, "variantCode");
    const product = await withStoreWriteLock(() => setProductStock(variantCode, stock));
    if (!product) return response.status(404).json({ error: "Saree variant was not found." });
    response.json({ product });
  }),
);

app.post(
  "/api/admin/categories",
  requireAuth,
  requireAdmin,
  asyncRoute(async (request, response) => {
    const { name } = categorySchema.parse(request.body);
    response.status(201).json({ category: await addCategory(name) });
  }),
);

app.patch(
  "/api/admin/orders/:orderId",
  requireAuth,
  requireAdmin,
  asyncRoute(async (request, response) => {
    const changes = orderStatusSchema.parse(request.body);
    if (changes.status === "Shipped" && (!changes.carrier || !changes.trackingNumber)) {
      return response.status(400).json({ error: "Carrier and tracking number are required when marking an order as shipped." });
    }
    const order = await updateOrder(pathParam(request, "orderId"), changes);
    if (!order) return response.status(404).json({ error: "Order was not found." });
    const { sheetRow: _sheetRow, ...publicOrder } = order as Order & { sheetRow?: number };
    response.json({ order: publicOrder });
  }),
);

if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist/client"));
  app.get("/{*path}", (_request, response) => response.sendFile("index.html", { root: "dist/client" }));
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
    return;
  }
  const status = Number(error?.status);
  if (status >= 400 && status < 600) {
    response.status(status).json({ error: error.message });
    return;
  }
  console.error("Request failed:", error);
  response.status(500).json({ error: "Something went wrong. Please try again." });
};
app.use(errorHandler);

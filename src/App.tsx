import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError, json } from "./api";

type Role = "admin" | "customer";
type Address = {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
};
type User = { email: string; role: Role; name: string; address: Address | null };
type Product = {
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
};
type Order = {
  orderId: string;
  email: string;
  items: Array<{ variantCode: string; name: string; color: string; quantity: number; unitPrice: number }>;
  total: number;
  address: Address;
  status: string;
  carrier: string;
  trackingNumber: string;
  createdAt: string;
};
type Page = "shop" | "saved" | "cart" | "account" | "admin";

const blankAddress: Address = { fullName: "", phone: "", street: "", city: "", region: "", postalCode: "" };
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function StockLabel({ stock }: { stock: number }) {
  if (stock === 0) return <span className="stock out">Out of stock</span>;
  if (stock === 1) return <span className="stock low">Only 1 saree left</span>;
  if (stock <= 3) return <span className="stock low">Only {stock} sarees left</span>;
  return <span className="stock available">Ready to ship</span>;
}

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState<Page>("shop");
  const [filter, setFilter] = useState("All sarees");
  const [search, setSearch] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshProducts = useCallback(async () => {
    const [productData, categoryData] = await Promise.all([
      api<{ products: Product[] }>("/products"),
      api<{ categories: string[] }>("/categories"),
    ]);
    setProducts(productData.products);
    setCategories(categoryData.categories);
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const { user: account } = await api<{ user: User }>("/me");
      setUser(account);
      const [saved, orderData] = await Promise.all([
        api<{ cart: Record<string, number>; wishlist: string[] }>("/cart"),
        api<{ orders: Order[] }>("/orders"),
      ]);
      setCart(saved.cart);
      setWishlist(saved.wishlist);
      setOrders(orderData.orders);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setUser(null);
        setCart({});
        setWishlist([]);
        setOrders([]);
        return;
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    void Promise.all([refreshProducts(), refreshAccount()]).catch((cause: Error) => setError(cause.message));
  }, [refreshAccount, refreshProducts]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = filter === "All sarees" || product.category === filter;
      const matchesSearch = !query || [product.name, product.category, product.color, product.designCode].some((value) => value.toLowerCase().includes(query));
      const matchesPage = page !== "saved" || wishlist.includes(product.variantCode);
      return matchesCategory && matchesSearch && matchesPage;
    });
  }, [filter, page, products, search, wishlist]);

  const cartItems = useMemo(
    () => Object.entries(cart).flatMap(([code, quantity]) => {
      const product = products.find((item) => item.variantCode === code);
      return product ? [{ product, quantity }] : [];
    }),
    [cart, products],
  );
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  async function runAction(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function setQuantity(product: Product, quantity: number) {
    if (!user) {
      setAuthMode("login");
      setError("Sign in to add a saree to your cart.");
      return;
    }
    if (quantity > product.stock) {
      setError(product.stock ? `Only ${product.stock} left in stock.` : "This saree is out of stock.");
      return;
    }
    await runAction(async () => {
      const result = await api<{ cart: Record<string, number> }>("/cart", json("PUT", { variantCode: product.variantCode, quantity }));
      setCart(result.cart);
    }, "Your cart has been updated.");
  }

  async function toggleWishlist(product: Product) {
    if (!user) {
      setAuthMode("login");
      setError("Sign in to save your favourites.");
      return;
    }
    await runAction(async () => {
      if (wishlist.includes(product.variantCode)) {
        const result = await api<{ wishlist: string[] }>(`/wishlist/${encodeURIComponent(product.variantCode)}`, json("DELETE"));
        setWishlist(result.wishlist);
      } else {
        const result = await api<{ wishlist: string[] }>(`/wishlist/${encodeURIComponent(product.variantCode)}`, json("PUT"));
        setWishlist(result.wishlist);
      }
    });
  }

  async function buyNow(product: Product) {
    if (!user) {
      setAuthMode("login");
      setError("Sign in to place an order.");
      return;
    }
    if (product.stock < 1) {
      setError("This saree is out of stock.");
      return;
    }
    await runAction(async () => {
      const result = await api<{ cart: Record<string, number> }>("/cart", json("PUT", { variantCode: product.variantCode, quantity: 1 }));
      setCart(result.cart);
      setPage("cart");
    });
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    await runAction(async () => {
      const result = await api<{ user: User }>(`/auth/${authMode}`, json("POST", body));
      setUser(result.user);
      setAuthMode(null);
      await refreshAccount();
    }, authMode === "register" ? "Welcome to Loom & Aura." : "You are signed in.");
  }

  async function signOut() {
    await runAction(async () => {
      await api("/auth/logout", json("POST"));
      setUser(null);
      setCart({});
      setWishlist([]);
      setOrders([]);
      setPage("shop");
    }, "You are signed out.");
  }

  async function checkout(address: Address) {
    await runAction(async () => {
      const { order } = await api<{ order: Order }>("/orders", json("POST", address));
      setOrders((current) => [order, ...current]);
      setCart({});
      setUser((current) => current ? { ...current, address } : current);
      await refreshProducts();
      setPage("account");
    }, "Your order has been placed. You can follow its progress in My account.");
  }

  async function saveAddress(address: Address) {
    await runAction(async () => {
      const result = await api<{ user: User }>("/me/address", json("PUT", address));
      setUser(result.user);
    }, "Your delivery address has been saved.");
  }

  async function refreshOrders() {
    const result = await api<{ orders: Order[] }>("/orders");
    setOrders(result.orders);
  }

  function navigate(next: Page) {
    setPage(next);
    setError("");
    setNotice("");
    if (next === "account" && !user) setAuthMode("login");
    if (next === "admin" && user?.role !== "admin") setError("Administrator access is required.");
  }

  const visibleProducts = page === "cart" || page === "account" || page === "admin" ? [] : filteredProducts;

  return (
    <div className="app-shell">
      <div className="announcement">Complimentary delivery on orders over ₹2,500 <span>✦</span> Made for the moments that matter</div>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("shop")} aria-label="Loom and Aura home">
          <span className="brand-mark">L<span>&</span>A</span><span className="brand-name">LOOM <i>&</i> AURA</span>
        </button>
        <div className="searchbox"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find your perfect saree..." /></div>
        <nav className="nav-actions">
          <button onClick={() => navigate("saved")} aria-label="Saved sarees">♡<span className="nav-label">Saved</span></button>
          <button onClick={() => navigate("cart")} aria-label="Shopping bag">♧<span className="nav-label">Bag</span>{cartCount > 0 && <b className="count-badge">{cartCount}</b>}</button>
          {user ? <>
            <button onClick={() => navigate(user.role === "admin" ? "admin" : "account")} aria-label="My account">◉<span className="nav-label">{user.role === "admin" ? "Admin" : "Account"}</span></button>
            <button className="logout-nav" onClick={() => void signOut()} disabled={busy} aria-label="Log out"><span aria-hidden>↪</span><span className="logout-label">Log out</span></button>
          </> : <button onClick={() => setAuthMode("login")}><span className="nav-label">Sign in</span><span aria-hidden>♙</span></button>}
        </nav>
      </header>

      <main>
        {page === "shop" && <section className="hero">
          <div className="hero-copy"><span className="eyebrow">WOVEN WITH FEELING</span><h1>Every thread<br />tells <em>your story.</em></h1><p>Thoughtfully chosen sarees for celebrations, quiet moments, and everything beautifully in between.</p><button className="button button-dark" onClick={() => document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" })}>Explore the collection <span>→</span></button><div className="hero-note"><span>✳</span> Timeless craft. A little bit of magic.</div></div>
          <div className="hero-art"><div className="hero-glow" /><div className="hero-image"><img src="https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1000&q=85" alt="Traditional red and gold saree" /></div><div className="hero-stamp">Draped<br />in wonder <span>✦</span></div><div className="hero-caption">THE FESTIVE EDIT <span>— 2026</span></div></div>
        </section>}

        {page === "shop" && <section className="promise-row"><div><span>✧</span><p><b>Handpicked with care</b><small>Artisan-made, always</small></p></div><div><span>◈</span><p><b>Easy, thoughtful delivery</b><small>Updates all the way home</small></p></div><div><span>♡</span><p><b>A little help, always</b><small>Here for your questions</small></p></div></section>}

        {notice && <div className="toast success-toast">{notice}<button onClick={() => setNotice("")}>×</button></div>}
        {error && <div className="toast error-toast">{error}<button onClick={() => setError("")}>×</button></div>}

        {visibleProducts.length >= 0 && (page === "shop" || page === "saved") && <section className="collection section-wrap" id="collection">
          <div className="section-heading"><div><span className="eyebrow">{page === "saved" ? "YOUR LITTLE COLLECTION" : "THE LOOM & AURA EDIT"}</span><h2>{page === "saved" ? "Sarees you love" : "Find your forever drape"}</h2><p>{page === "saved" ? "The ones you’ve been dreaming of." : "A little something for every version of you."}</p></div><span className="product-count">{filteredProducts.length} {filteredProducts.length === 1 ? "saree" : "sarees"}</span></div>
          <div className="filter-row"><div className="category-pills"><button className={filter === "All sarees" ? "active" : ""} onClick={() => setFilter("All sarees")}>All sarees</button>{categories.map((category) => <button key={category} className={filter === category ? "active" : ""} onClick={() => setFilter(category)}>{category}</button>)}</div><span className="sort-label">A thoughtful edit</span></div>
          {filteredProducts.length ? <div className="product-grid">{filteredProducts.map((product) => <article className="product-card" key={product.variantCode}>
            <div className="product-photo">
              {product.imageUrl ? <img src={product.imageUrl} alt={`${product.name} saree in ${product.color}`} loading="lazy" /> : <div className="photo-placeholder"><span>✳</span><small>LOOM & AURA</small></div>}
              <button className={`save-button ${wishlist.includes(product.variantCode) ? "saved" : ""}`} onClick={() => void toggleWishlist(product)} aria-label={wishlist.includes(product.variantCode) ? "Remove from saved" : "Save saree"}>{wishlist.includes(product.variantCode) ? "♥" : "♡"}</button>
              <span className="code-tag">{product.variantCode}</span>
            </div>
            <div className="product-info"><div className="product-category">{product.category} <span>·</span> {product.color}</div><h3>{product.name}</h3><div className="product-bottom"><strong>{money.format(product.price)}</strong><StockLabel stock={product.stock} /></div><button className="add-button" disabled={product.stock === 0 || busy} onClick={() => void setQuantity(product, (cart[product.variantCode] || 0) + 1)}>{product.stock === 0 ? "Currently unavailable" : "Add to bag"} <span>＋</span></button><button className="buy-now-button" disabled={product.stock === 0 || busy} onClick={() => void buyNow(product)}>Buy now <span>→</span></button></div>
          </article>)}</div> : <div className="empty-state"><span>♡</span><h3>{page === "saved" ? "Your saved list is waiting" : "Nothing in this little corner just yet"}</h3><p>{page === "saved" ? "Tap the heart on a saree to keep it close." : "Try another search or category."}</p><button className="text-button" onClick={() => navigate("shop")}>Back to the collection →</button></div>}
        </section>}

        {page === "cart" && <section className="section-wrap account-section"><SectionTitle eyebrow="YOUR LITTLE BUNDLE" title="Shopping bag" subtitle="A beautiful choice, in the making." />{user ? <CartView items={cartItems} busy={busy} onQuantity={setQuantity} onRemove={(code) => void runAction(async () => { await api(`/cart/${encodeURIComponent(code)}`, json("DELETE")); setCart((current) => { const next = { ...current }; delete next[code]; return next; }); })} address={user.address} onCheckout={checkout} onShop={() => navigate("shop")} /> : <SignInPrompt onSignIn={() => setAuthMode("login")} />}</section>}

        {page === "account" && <section className="section-wrap account-section"><SectionTitle eyebrow="YOUR LOOM & AURA" title={`Hello, ${user?.name || "there"}`} subtitle="Your orders, address, and delivery updates—all together." />{user ? <AccountView user={user} orders={orders} busy={busy} onSaveAddress={saveAddress} onRefresh={() => void runAction(refreshOrders)} onSignOut={signOut} /> : <SignInPrompt onSignIn={() => setAuthMode("login")} />}</section>}

        {page === "admin" && <section className="section-wrap account-section"><SectionTitle eyebrow="STORE STUDIO" title="The atelier" subtitle="Care for the collection, the orders, and the people behind them." />{user?.role === "admin" ? <AdminView products={products} categories={categories} orders={orders} busy={busy} onRefresh={async () => { await refreshProducts(); await refreshOrders(); }} onDone={async () => { await refreshProducts(); await refreshOrders(); }} /> : <SignInPrompt onSignIn={() => setAuthMode("login")} />}</section>}
      </main>

      <footer className="footer"><div className="footer-brand"><span className="brand-mark">L<span>&</span>A</span><p>For every story you wear.</p></div><div><span>THE ATELIER</span><a href="#collection" onClick={() => navigate("shop")}>Our sarees</a><a href="#" onClick={(event) => event.preventDefault()}>Care guide</a></div><div><span>HERE FOR YOU</span><a href="mailto:hello@loomandaura.example">Say hello</a><a href="#" onClick={(event) => event.preventDefault()}>Shipping & returns</a></div><div className="footer-note">Made with care,<br />worn with joy. <span>✦</span></div><small>© 2026 Loom & Aura. Made for the moments that matter.</small></footer>

      {authMode && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}><div className="auth-modal"><button className="modal-close" onClick={() => setAuthMode(null)} aria-label="Close">×</button><span className="eyebrow">{authMode === "register" ? "A PLACE JUST FOR YOU" : "WELCOME BACK"}</span><h2>{authMode === "register" ? "Join the story." : "Come on in."}</h2><p>{authMode === "register" ? "Save your favourites and keep an eye on every order." : "Your favourite drapes are right where you left them."}</p><form onSubmit={(event) => void submitAuth(event)} className="form-stack">
        {authMode === "register" && <Field label="Your name" name="name" autoComplete="name" required />}
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} minLength={8} required />
        <button className="button button-dark full-button" disabled={busy}>{busy ? "One moment..." : authMode === "register" ? "Create your account" : "Sign in"}</button>
      </form><div className="auth-switch">{authMode === "register" ? "Already have an account?" : "New to Loom & Aura?"} <button onClick={() => setAuthMode(authMode === "register" ? "login" : "register")}>{authMode === "register" ? "Sign in" : "Create an account"}</button></div></div></div>}
    </div>
  );
}

function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="section-heading account-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function Field({ label, name, type = "text", required = false, autoComplete, minLength }: { label: string; name: string; type?: string; required?: boolean; autoComplete?: string; minLength?: number }) {
  return <label className="field">{label}<input name={name} type={type} required={required} autoComplete={autoComplete} minLength={minLength} /></label>;
}

function AddressFields({ value, onChange }: { value: Address; onChange: (address: Address) => void }) {
  const update = (key: keyof Address, next: string) => onChange({ ...value, [key]: next });
  return <div className="address-grid">
    <label className="field">Full name<input required value={value.fullName} onChange={(event) => update("fullName", event.target.value)} autoComplete="name" /></label>
    <label className="field">Phone number<input required value={value.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" /></label>
    <label className="field full-span">Street address<input required value={value.street} onChange={(event) => update("street", event.target.value)} autoComplete="street-address" /></label>
    <label className="field">City<input required value={value.city} onChange={(event) => update("city", event.target.value)} autoComplete="address-level2" /></label>
    <label className="field">State / region<input required value={value.region} onChange={(event) => update("region", event.target.value)} autoComplete="address-level1" /></label>
    <label className="field">Postal code<input required value={value.postalCode} onChange={(event) => update("postalCode", event.target.value)} autoComplete="postal-code" /></label>
  </div>;
}

function CartView({ items, busy, onQuantity, onRemove, address, onCheckout, onShop }: {
  items: Array<{ product: Product; quantity: number }>;
  busy: boolean;
  onQuantity: (product: Product, quantity: number) => void;
  onRemove: (code: string) => void;
  address: Address | null;
  onCheckout: (address: Address) => void;
  onShop: () => void;
}) {
  const [shipping, setShipping] = useState(address || blankAddress);
  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  if (!items.length) return <div className="empty-state"><span>♧</span><h3>Your bag is taking a little breather</h3><p>When something feels just right, you’ll find it here.</p><button className="text-button" onClick={onShop}>Explore sarees →</button></div>;
  return <div className="cart-layout"><div className="cart-list">{items.map(({ product, quantity }) => <article className="cart-item" key={product.variantCode}><div className="cart-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>✳</span>}</div><div className="cart-details"><span className="product-category">{product.variantCode} · {product.color}</span><h3>{product.name}</h3><strong>{money.format(product.price)}</strong><StockLabel stock={product.stock} /><div className="quantity-control"><button aria-label="Remove one" onClick={() => quantity <= 1 ? onRemove(product.variantCode) : onQuantity(product, quantity - 1)}>−</button><span>{quantity}</span><button aria-label="Add one" disabled={quantity >= product.stock} onClick={() => onQuantity(product, quantity + 1)}>＋</button><button className="remove-link" onClick={() => onRemove(product.variantCode)}>Remove</button></div></div><strong className="line-total">{money.format(product.price * quantity)}</strong></article>)}</div><aside className="checkout-card"><span className="eyebrow">DELIVERY DETAILS</span><h3>Where should we send it?</h3><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onCheckout(shipping); }}><AddressFields value={shipping} onChange={setShipping} /><div className="checkout-total"><span>Order total</span><strong>{money.format(total)}</strong></div><p className="offline-note">Payment is not collected in this store. The team will follow up with you to arrange it.</p><button className="button button-dark full-button" disabled={busy}>{busy ? "Placing order..." : "Place order"}</button></form></aside></div>;
}

function SignInPrompt({ onSignIn }: { onSignIn: () => void }) {
  return <div className="sign-in-prompt"><span>✧</span><h3>Your little corner is just one sign-in away</h3><p>Sign in to see your bag, keep your favourites, and follow your delivery.</p><button className="button button-dark" onClick={onSignIn}>Sign in to continue</button></div>;
}

function AccountView({ user, orders, busy, onSaveAddress, onRefresh, onSignOut }: {
  user: User;
  orders: Order[];
  busy: boolean;
  onSaveAddress: (address: Address) => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [address, setAddress] = useState(user.address || blankAddress);
  return <div className="account-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">YOUR DELIVERY DETAILS</span><h3>A familiar doorstep</h3></div></div><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSaveAddress(address); }}><AddressFields value={address} onChange={setAddress} /><button className="button button-outline" disabled={busy}>Save address</button></form><button className="text-button signout-link" onClick={onSignOut}>Sign out of your account →</button></section><section className="panel orders-panel"><div className="panel-heading"><div><span className="eyebrow">FOLLOW THE THREAD</span><h3>Your orders</h3></div><button className="refresh-button" onClick={onRefresh}>↻ Refresh</button></div>{orders.length ? <div className="order-list">{orders.map((order) => <OrderCard key={order.orderId} order={order} />)}</div> : <div className="empty-inline"><span>✧</span><p>No orders yet. Your next favourite is waiting.</p></div>}</section><div className="account-email"><span>SIGNED IN AS</span><strong>{user.email}</strong></div></div>;
}

function OrderCard({ order }: { order: Order }) {
  return <article className="order-card"><div className="order-top"><div><span className="order-id">{order.orderId}</span><small>{new Date(order.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</small></div><span className={`status-pill status-${order.status.toLowerCase()}`}>{order.status}</span></div><div className="order-products">{order.items.map((item) => <div key={item.variantCode}><span>{item.name} · {item.color} <small>× {item.quantity}</small></span><strong>{money.format(item.unitPrice * item.quantity)}</strong></div>)}</div><div className="order-total"><span>Total</span><strong>{money.format(order.total)}</strong></div>{order.status === "Shipped" && <div className="tracking-box"><span>✦ ON ITS WAY</span><b>{order.carrier || "Carrier"} {order.trackingNumber && `· ${order.trackingNumber}`}</b><small>Tracking updates may take a little while to appear.</small></div>}<div className="delivery-address"><span>DELIVERING TO</span>{order.address.fullName}, {order.address.street}, {order.address.city}, {order.address.region} {order.address.postalCode}</div></article>;
}

function AdminView({ products, categories, orders, busy, onRefresh, onDone }: {
  products: Product[];
  categories: string[];
  orders: Order[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onDone: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [variantFor, setVariantFor] = useState("");
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({});
  const [orderEdits, setOrderEdits] = useState<Record<string, { status: string; carrier: string; trackingNumber: string }>>({});

  async function submit(event: FormEvent<HTMLFormElement>, endpoint: string, method = "POST") {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const data = Object.fromEntries(form.entries());
    setFailure("");
    setMessage("");
    try {
      await api(endpoint, json(method, data));
      setMessage("Saved to your store.");
      formElement.reset();
      await onDone();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not save your changes.");
    }
  }

  async function updateStock(code: string) {
    setFailure("");
    setMessage("");
    try {
      await api(`/admin/products/${encodeURIComponent(code)}/stock`, json("PATCH", { stock: stockEdits[code] }));
      setMessage(`${code} stock updated.`);
      await onDone();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not update stock.");
    }
  }

  async function updateOrder(order: Order) {
    const changes = orderEdits[order.orderId] || { status: order.status, carrier: order.carrier, trackingNumber: order.trackingNumber };
    setFailure("");
    setMessage("");
    try {
      await api(`/admin/orders/${encodeURIComponent(order.orderId)}`, json("PATCH", changes));
      setMessage(`${order.orderId} updated.`);
      await onDone();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not update this order.");
    }
  }

  const designs = [...new Set(products.map((product) => product.designCode))];
  return (
    <div className="admin-content">
      {(message || failure) && <div className={`admin-alert ${failure ? "error-toast" : "success-toast"}`}>{failure || message}<button onClick={() => { setMessage(""); setFailure(""); }}>×</button></div>}
      <div className="admin-columns">
        <section className="panel">
          <span className="eyebrow">NEW DESIGN</span>
          <h3>Add a saree to the edit</h3>
          <p className="panel-intro">The design code and first colour code are generated for you.</p>
          <form className="form-stack" onSubmit={(event) => void submit(event, "/admin/products")}>
            <Field label="Saree / design name" name="name" required />
            <label className="field">Category<select name="category" required defaultValue=""><option value="" disabled>Choose a category</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <Field label="Description" name="description" required />
            <div className="admin-form-grid">
              <Field label="First colour" name="color" required />
              <Field label="Price (₹)" name="price" type="number" required />
              <Field label="Pieces in stock" name="stock" type="number" required />
              <Field label="Image URL (optional)" name="imageUrl" type="url" />
            </div>
            <button className="button button-dark" disabled={busy}>Add design & generate code</button>
          </form>
        </section>
        <section className="panel">
          <span className="eyebrow">THE CATEGORIES</span>
          <h3>Make room for another edit</h3>
          <form className="inline-form" onSubmit={(event) => void submit(event, "/admin/categories")}>
            <Field label="Category name" name="name" required />
            <button className="button button-outline">Add category</button>
          </form>
          <div className="category-admin-list">{categories.map((category) => <span key={category}>{category}</span>)}</div>
          <p className="panel-footnote">Colour variations share a design code; every colour receives its own unique code, like LAN109-1.</p>
        </section>
      </div>

      <section className="panel admin-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">ON THE RAIL</span><h3>Inventory & colourways</h3></div>
          <button className="refresh-button" onClick={() => void onRefresh()}>↻ Refresh</button>
        </div>
        {products.length ? (
          <div className="inventory-table">
            <div className="inventory-head"><span>DESIGN / COLOUR</span><span>CODE</span><span>PRICE</span><span>PIECES</span><span>UPDATE</span></div>
            {designs.map((design) => (
              <div className="design-block" key={design}>
                <div className="design-header">
                  <b>{products.find((item) => item.designCode === design)?.name}</b>
                  <span>{design}</span>
                  <button className="text-button" onClick={() => setVariantFor(variantFor === design ? "" : design)}>{variantFor === design ? "Close" : "+ Add colourway"}</button>
                </div>
                {products.filter((item) => item.designCode === design).map((product) => (
                  <div className="inventory-row" key={product.variantCode}>
                    <span>{product.color}<small>{product.category}</small></span>
                    <code>{product.variantCode}</code>
                    <span>{money.format(product.price)}</span>
                    <div className="stock-editor">
                      <input aria-label={`Stock for ${product.variantCode}`} type="number" min="0" value={stockEdits[product.variantCode] ?? product.stock} onChange={(event) => setStockEdits((current) => ({ ...current, [product.variantCode]: event.target.value }))} />
                      <StockLabel stock={Number(stockEdits[product.variantCode] ?? product.stock)} />
                    </div>
                    <button className="mini-button" onClick={() => void updateStock(product.variantCode)}>Save stock</button>
                  </div>
                ))}
                {variantFor === design && (
                  <form className="variant-form" onSubmit={(event) => void submit(event, `/admin/products/${encodeURIComponent(design)}/variants`)}>
                    <b>Add a colourway to {design}</b>
                    <div className="admin-form-grid">
                      <Field label="Colour" name="color" required />
                      <Field label="Price (₹)" name="price" type="number" required />
                      <Field label="Pieces in stock" name="stock" type="number" required />
                      <Field label="Image URL (optional)" name="imageUrl" type="url" />
                    </div>
                    <button className="button button-outline">Add colourway</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        ) : <div className="empty-inline"><p>No sarees yet. Add the first design above.</p></div>}
      </section>

      <section className="panel admin-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">A NOTE FROM THE ATELIER</span><h3>Orders & delivery</h3></div>
          <button className="refresh-button" onClick={() => void onRefresh()}>↻ Refresh</button>
        </div>
        {orders.length ? (
          <div className="admin-order-list">
            {orders.map((order) => {
              const edit = orderEdits[order.orderId] || { status: order.status, carrier: order.carrier, trackingNumber: order.trackingNumber };
              return (
                <article className="admin-order" key={order.orderId}>
                  <div className="admin-order-summary">
                    <div>
                      <span className="order-id">{order.orderId}</span>
                      <b>{order.address.fullName} · {order.email}</b>
                      <span>{order.items.map((item) => `${item.name} (${item.color}) × ${item.quantity}`).join(" · ")}</span>
                    </div>
                    <strong>{money.format(order.total)}</strong>
                  </div>
                  <div className="customer-address"><b>Ship to</b> {order.address.fullName}, {order.address.phone}, {order.address.street}, {order.address.city}, {order.address.region} {order.address.postalCode}</div>
                  <div className="order-update-row">
                    <label className="field">Status<select value={edit.status} onChange={(event) => setOrderEdits((current) => ({ ...current, [order.orderId]: { ...edit, status: event.target.value } }))}>{["Placed", "Confirmed", "Packed", "Shipped", "Delivered"].map((status) => <option key={status}>{status}</option>)}</select></label>
                    <label className="field">Carrier<input value={edit.carrier} placeholder="e.g. India Post" onChange={(event) => setOrderEdits((current) => ({ ...current, [order.orderId]: { ...edit, carrier: event.target.value } }))} /></label>
                    <label className="field">Tracking number<input value={edit.trackingNumber} placeholder="Shipment tracking ID" onChange={(event) => setOrderEdits((current) => ({ ...current, [order.orderId]: { ...edit, trackingNumber: event.target.value } }))} /></label>
                    <button className="button button-outline" onClick={() => void updateOrder(order)}>Save update</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="empty-inline"><p>Your orders will appear here after a customer checks out.</p></div>}
      </section>
    </div>
  );
}

export default App;

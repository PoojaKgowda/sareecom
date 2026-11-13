# Loom & Aura — Saree Store

A React storefront and Node.js API that use your Google spreadsheet as the store's database. A small Google Apps Script, attached to the spreadsheet, gives the server secure access to the sheet. No service-account JSON or Google Cloud project is needed.

Customers can browse sarees and colourways, save favourites, keep a cart, place orders, save a delivery address, and see order/shipping updates. Admins can manage categories, sarees, stock, orders, addresses, and carrier tracking details. Payment collection and payment transactions are intentionally not included.

## Requirements

- Node.js 20 or newer
- Your Google spreadsheet

## One-time Google Sheets setup

1. Open your spreadsheet and choose **Extensions → Apps Script**.
2. Replace the editor contents with [`apps-script/Code.gs`](./apps-script/Code.gs) and save the project.
3. In the function selector, choose `setup` and click **Run**. Approve Google's authorization prompt. This creates the required sheet tabs and displays a private key. Copy the key; do not share it.
4. Choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then deploy and authorize if asked. Copy the web app URL ending in `/exec`.
5. In the project folder, copy `.env.example` to `.env`. Add the copied web app URL to `GOOGLE_APPS_SCRIPT_URL` and the private key from step 3 to `GOOGLE_APPS_SCRIPT_SECRET`.
6. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Use a unique password of at least 8 characters; a longer password is recommended. The first successful server startup creates the admin account. Later changes to these settings do not reset an existing account's password.
7. Run `npm install`, then `npm run dev`. Open `http://localhost:5173`.

The Apps Script web app must be accessible to **Anyone** so the Node server can call it without signing in as a Google user. The generated shared key protects the endpoint; keep it private in `.env`. Spreadsheet data remains in your Google account and is accessed by the Apps Script running as you.

If you change or redeploy the Apps Script, use the deployed `/exec` URL in `.env`. If you run `setup` again, it generates a new shared key; update `GOOGLE_APPS_SCRIPT_SECRET` to match.

The server creates the `Products`, `Categories`, `Users`, and `Orders` tabs, including their header rows. Customer accounts, password hashes, saved addresses, carts, wishlists, inventory, and orders are stored in the spreadsheet.

## Saree codes and stock

Each design gets an automatically generated code such as `LAN109`. Its first colourway is `LAN109-1`; additional colourways added to the same design become `LAN109-2`, and so on. Every colourway has its own price, image, and piece count. Customers see “Only 1 saree left,” “Only N sarees left” for two or three pieces, and “Out of stock” at zero. The Apps Script serializes inventory changes and updates stock when an order is placed.

## Run and build

- `npm run dev` — API and Vite development server
- `npm test` — unit tests
- `npm run build` — type-check and create the production client bundle
- `npm start` — start the production API and serve `dist/client`
- `npm run reset-admin-password` — update the existing admin password hash from `ADMIN_PASSWORD` in `.env`

To reset a forgotten admin password, first replace `ADMIN_PASSWORD` in `.env` with a new unique password, then run `npm run reset-admin-password`. The command updates only the matching existing admin's password hash in the `Users` sheet; it does not change customer accounts or other admin data. Keep the new password private.

In production, use HTTPS and set `NODE_ENV=production` so session cookies are marked secure. Session signing keys are generated automatically for local use; restarting the server signs customers out.

## Deploy to Vercel

The repository includes a Vercel serverless function for `/api/*`; Vercel serves the built Vite client from `dist/client`. Import the repository into Vercel and use the default project root, build command, and output directory defined in [`vercel.json`](./vercel.json). Add `GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_APPS_SCRIPT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` to the Vercel project’s Environment Variables for every environment you use. Set `SESSION_SECRET` to a unique random value of at least 32 characters and keep it stable between deployments so customer sessions remain valid. Redeploy after setting or changing environment variables.

The API initializes the spreadsheet and seeds the admin account on its first request in each serverless instance. If the deployment still reports an API error, check the Vercel Function logs and confirm that the Apps Script deployment is accessible and its URL and secret match.

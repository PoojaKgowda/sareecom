import "dotenv/config";
import bcrypt from "bcryptjs";
import { findUser, saveUser } from "./store.js";
import { initializeSheets } from "./sheets.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file.");
}
if (password.length < 8 || password.length > 128) {
  throw new Error("ADMIN_PASSWORD must contain between 8 and 128 characters.");
}

await initializeSheets();
const record = await findUser(email);
if (!record || record.user.role !== "admin") {
  throw new Error("No existing administrator matches ADMIN_EMAIL.");
}

record.user.passwordHash = await bcrypt.hash(password, 12);
await saveUser(record.user, record.sheetRow);
console.log("Admin password updated. Sign in with ADMIN_EMAIL and ADMIN_PASSWORD.");

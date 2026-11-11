import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { findUser, createUser } from "./store.js";
import type { Role, SessionUser, User } from "./types.js";

const cookieName = "loom_session";
let generatedSessionSecret: string | undefined;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) {
    if (secret.length < 32) throw new Error("If set, SESSION_SECRET must contain at least 32 characters.");
    return secret;
  }
  generatedSessionSecret ??= randomBytes(32).toString("hex");
  return generatedSessionSecret;
}

export async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set to create the first administrator.");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must contain at least 8 characters.");
  if (await findUser(email)) return;
  const admin: User = {
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: "admin",
    name: "Store Admin",
    cart: {},
    wishlist: [],
    address: null,
    createdAt: new Date().toISOString(),
  };
  await createUser(admin);
}

export function issueSession(user: SessionUser): string {
  return jwt.sign(user, sessionSecret(), { expiresIn: "7d", issuer: "loom-aura" });
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(cookieName, { httpOnly: true, sameSite: "lax", path: "/" });
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const token = request.cookies?.[cookieName];
  if (!token) {
    response.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  try {
    request.user = jwt.verify(token, sessionSecret(), { issuer: "loom-aura" }) as SessionUser;
    next();
  } catch {
    clearSessionCookie(response);
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (request.user?.role !== ("admin" satisfies Role)) {
    response.status(403).json({ error: "Administrator access is required." });
    return;
  }
  next();
}

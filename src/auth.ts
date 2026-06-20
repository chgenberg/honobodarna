import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { config } from "./config.js";

const COOKIE = "sjobod_session";
const MAX_AGE = 60 * 60 * 12; // 12 timmar

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCredentials(username: string, password: string): boolean {
  const userOk = safeEqual(username, config.admin.username);
  const passOk = safeEqual(password, config.admin.password);
  return userOk && passOk;
}

export function issueSession(c: Context, username: string): void {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = `${username}.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

function isValidSession(c: Context): boolean {
  const token = getCookie(c, COOKIE);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!safeEqual(sig, sign(`${user}.${exp}`))) return false;
  if (Number(exp) < Date.now()) return false;
  return true;
}

// Middleware: skyddar alla rutter utom /login och statiska resurser.
export async function requireAuth(c: Context, next: Next) {
  if (isValidSession(c)) return next();
  return c.redirect("/login");
}

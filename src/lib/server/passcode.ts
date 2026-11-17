import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const g = globalThis as unknown as {
  __voyageCookieSecret?: string;
  __voyageRateLimits?: Map<string, { count: number; resetAt: number }>;
};

function getCookieSecret(): string {
  const envSecret =
    process.env.VOYAGE_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  if (envSecret) return envSecret;
  if (!g.__voyageCookieSecret) {
    g.__voyageCookieSecret = randomBytes(32).toString("hex");
  }
  return g.__voyageCookieSecret;
}

export function getUnlockCookieName(tripId: string): string {
  return `voyage_unlock_${tripId}`;
}

export function createUnlockToken(tripId: string, ttlMs = 30 * 24 * 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const payload = `${tripId}.${exp}`;
  const sig = createHmac("sha256", getCookieSecret()).update(payload).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyUnlockToken(tripId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac("sha256", getCookieSecret())
    .update(`${tripId}.${expStr}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 簡易スライディングウィンドウ・レート制限（true = 許可, false = 上限超過） */
export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const map = (g.__voyageRateLimits ??= new Map());
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || entry.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  entry.count += 1;
  return true;
}

/**
 * 4桁の合言葉（パスコード）のハッシュ化・照合（第1章）
 * - 平文はDBやサマリーに絶対に含めない
 */
export function hashPasscode(code: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(code, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPasscode(code: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return true;
  const [salt, hex] = storedHash.split(":");
  if (!salt || !hex) return false;
  const derived = scryptSync(code, salt, 32);
  const expected = Buffer.from(hex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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

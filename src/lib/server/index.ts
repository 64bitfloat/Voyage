import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { IdSchema } from "../export/schema";
import { MemoryStore } from "./memory-store";
import { getUnlockCookieName, verifyUnlockToken } from "./passcode";
import type { TripStore } from "./store";
import { SupabaseStore } from "./supabase-store";

let store: TripStore | null = null;

export function getStore(): TripStore {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    store = new SupabaseStore(url, key);
  } else {
    console.warn("[voyage] Supabase未設定のためメモリストアで動作します（再起動でデータは消えます）");
    store = new MemoryStore();
  }
  return store;
}

/* ---------------- API Route 共通ヘルパー ---------------- */

export function jsonError(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export function isUuid(v: string) {
  return IdSchema.safeParse(v).success;
}

/** リクエストボディを Zod で検証（保存時検証） */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: jsonError(400, "JSONを解釈できません") };
  }
  const r = schema.safeParse(body);
  if (!r.success) return { ok: false, res: jsonError(422, "入力内容に誤りがあります", r.error.issues) };
  return { ok: true, data: r.data };
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/**
 * 部屋IDと合言葉による認証（HttpOnly署名Cookie）をサーバー側で検証する。
 * 認証されていない場合は閲覧・書き込みともに403で拒否する。
 */
export async function requireTripWriteAccess(
  req: Request,
  tripId: string,
): Promise<NextResponse | null> {
  const doc = await getStore().getTripDoc(tripId);
  if (!doc) return jsonError(404, "部屋が見つかりません");
  const token = readCookie(req, getUnlockCookieName(tripId));
  if (!verifyUnlockToken(tripId, token)) {
    return jsonError(403, "部屋IDと合言葉の認証が必要です");
  }
  return null;
}

export function serverError(e: unknown) {
  console.error("[voyage]", e);
  return jsonError(500, "サーバーエラーが発生しました");
}

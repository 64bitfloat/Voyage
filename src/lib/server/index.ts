import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { IdSchema } from "../export/schema";
import { MemoryStore } from "./memory-store";
import type { TripStore } from "./store";
import { SupabaseStore } from "./supabase-store";

let store: TripStore | null = null;

export function getStore(): TripStore {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

export function serverError(e: unknown) {
  console.error("[voyage]", e);
  return jsonError(500, "サーバーエラーが発生しました");
}

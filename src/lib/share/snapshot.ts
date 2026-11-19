/**
 * URL共有用のスナップショット符号化・復号（UTF-8 JSON ↔ Base64URL）
 * - Supabase未接続時でも、共有リンク（`?s=...`）を送るだけで相手端末にしおり全体を復元できるようにする
 * - サーバー側の `/trip/[tripId]/summary?format=json&s=...` でもそのままデコードしてMuseへ返せる
 */
import type { TripDoc } from "../model/types";

export function encodeDocSnapshot(doc: TripDoc): string {
  // 写真やレシートの data URL（base64画像本体）は除外してURL長を抑える（https URLと項目内訳は保持）
  const slim: TripDoc = {
    ...doc,
    photos: [],
    costs: doc.costs.map((c) => ({
      ...c,
      receipts: (c.receipts ?? []).filter((r) => /^https:\/\//i.test(r.url)),
    })),
  };
  const json = JSON.stringify(slim);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf-8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDocSnapshot(encoded: string | null | undefined): TripDoc | null {
  if (!encoded) return null;
  try {
    let json: string;
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(encoded, "base64url").toString("utf-8");
    } else {
      const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
      const bin = atob(b64 + pad);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      json = new TextDecoder().decode(bytes);
    }
    const parsed = JSON.parse(json) as TripDoc;
    if (!parsed || typeof parsed !== "object" || !parsed.trip?.id || !Array.isArray(parsed.days)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

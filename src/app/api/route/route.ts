import { NextResponse } from "next/server";
import { z } from "zod";
import { LatSchema, LngSchema } from "@/lib/export/schema";
import { estimateRouteFallback, routeViaValhallaDirect } from "@/lib/routing/osrm";
import { getClientIp, jsonError, parseBody } from "@/lib/server";
import { checkRateLimit } from "@/lib/server/passcode";

const RouteRequestSchema = z.object({
  from: z.object({ lat: LatSchema, lng: LngSchema }),
  to: z.object({ lat: LatSchema, lng: LngSchema }),
  mode: z.enum(["car", "walk", "train"]),
  avoidTolls: z.boolean().optional().default(false),
});

/**
 * 2点間の移動時間・距離を算出するサーバーAPI
 * 1. GOOGLE_MAPS_API_KEY が設定されていれば Google Routes API（車/徒歩/電車 + 高速回避）を優先使用
 * 2. 未設定時は無料の Valhalla ルーティング（高速あり / 下道・有料回避の両対応）を使用
 * 3. 失敗時は直線距離×道路係数の概算を返す
 */
export async function POST(req: Request) {
  if (!checkRateLimit(`route:${getClientIp(req)}`, 60, 60_000)) {
    return jsonError(429, "ルート計算のリクエストが多すぎます。少し待ってから再度お試しください");
  }
  const parsed = await parseBody(req, RouteRequestSchema);
  if (!parsed.ok) return parsed.res;

  const { from, to, mode, avoidTolls } = parsed.data;
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;

  if (gmapsKey) {
    try {
      const travelMode =
        mode === "walk" ? "WALK" : mode === "train" ? "TRANSIT" : "DRIVE";
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": gmapsKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode,
          ...(travelMode === "DRIVE" && avoidTolls
            ? { routeModifiers: { avoidTolls: true, avoidHighways: true } }
            : {}),
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          routes?: { duration?: string; distanceMeters?: number }[];
        };
        const route = json.routes?.[0];
        if (route?.duration && route.distanceMeters != null) {
          const sec = Number(route.duration.replace("s", ""));
          return NextResponse.json({
            duration_minutes: Math.max(1, Math.round(sec / 60)),
            distance_m: Math.round(route.distanceMeters),
          });
        }
      }
    } catch {
      // Google API 失敗時は Valhalla へフォールバック
    }
  }

  try {
    const result = await routeViaValhallaDirect(from, to, mode, avoidTolls);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(estimateRouteFallback(from, to, mode, avoidTolls));
  }
}

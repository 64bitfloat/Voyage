import { RouteError, type LatLng, type RoutableMode, type RouteOptions, type RouteProvider, type RouteResult } from "./types";

const cache = new Map<string, RouteResult>();
const key = (a: LatLng, b: LatLng, m: RoutableMode, avoidTolls: boolean) =>
  `${m}|${avoidTolls ? "notoll" : "toll"}|${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 2点間の座標から道路迂回係数（1.35倍）を考慮した概算の距離(m)と所要時間(分)を返す */
export function estimateRouteFallback(
  from: LatLng,
  to: LatLng,
  mode: RoutableMode,
  avoidTolls = false,
): RouteResult {
  const distance_m = Math.max(100, Math.round(haversineMeters(from, to) * 1.35));
  // 徒歩: 約4.2km/h (70m/分)、下道車: 約35km/h (580m/分)、高速車: 約58km/h (967m/分)、電車: 約50km/h (833m/分)
  const metersPerMin =
    mode === "walk" ? 70 : mode === "train" ? 833 : avoidTolls ? 580 : 967;
  const duration_minutes = Math.max(1, Math.round(distance_m / metersPerMin));
  return { duration_minutes, distance_m };
}

/**
 * サーバー側 `/api/route` 経由でルート計算を行うプロバイダ
 * - サーバー側では Google Maps Routes API（キー設定時）または Valhalla（高速/下道対応・無料）を実行
 * - サーバー環境（テストスクリプト等）から直接呼ばれた場合は Valhalla へ直接フォールバック
 */
export class OsrmRouteProvider implements RouteProvider {
  readonly name = "Valhalla / Google Routes";

  async route(
    from: LatLng,
    to: LatLng,
    mode: RoutableMode,
    options?: RouteOptions,
  ): Promise<RouteResult> {
    const avoidTolls = Boolean(options?.avoidTolls);
    const k = key(from, to, mode, avoidTolls);
    const hit = cache.get(k);
    if (hit) return hit;

    try {
      let result: RouteResult;
      if (typeof window !== "undefined") {
        const res = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, mode, avoidTolls }),
          signal: options?.signal,
        });
        if (!res.ok) throw new RouteError(`HTTP ${res.status}`);
        result = (await res.json()) as RouteResult;
      } else {
        result = await routeViaValhallaDirect(from, to, mode, avoidTolls, options?.signal);
      }
      cache.set(k, result);
      return result;
    } catch {
      return estimateRouteFallback(from, to, mode, avoidTolls);
    }
  }
}

export async function routeViaValhallaDirect(
  from: LatLng,
  to: LatLng,
  mode: RoutableMode,
  avoidTolls: boolean,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const costing = mode === "walk" ? "pedestrian" : "auto";
    const body = {
      locations: [
        { lat: from.lat, lon: from.lng },
        { lat: to.lat, lon: to.lng },
      ],
      costing,
      ...(costing === "auto"
        ? {
            costing_options: {
              auto: {
                use_tolls: avoidTolls ? 0 : 1,
                use_highways: avoidTolls ? 0 : 1,
              },
            },
          }
        : {}),
      units: "km",
    };

    const res = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });
    if (!res.ok) throw new RouteError(`Valhalla HTTP ${res.status}`);
    const json = (await res.json()) as {
      trip?: { summary?: { time?: number; length?: number } };
    };
    const sum = json.trip?.summary;
    if (!sum || sum.time == null || sum.length == null) {
      throw new RouteError("No route summary");
    }
    const distance_m = Math.max(100, Math.round(sum.length * 1000));
    let duration_minutes = Math.max(1, Math.round(sum.time / 60));
    if (mode === "train") {
      // 電車は車（高速）の約0.85倍＋乗り換えバッファ5分で概算
      duration_minutes = Math.max(5, Math.round(duration_minutes * 0.85) + 5);
    }
    return { duration_minutes, distance_m };
  } finally {
    clearTimeout(timer);
  }
}

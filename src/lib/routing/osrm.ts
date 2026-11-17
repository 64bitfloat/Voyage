import { RouteError, type LatLng, type RoutableMode, type RouteProvider, type RouteResult } from "./types";

/**
 * OSRM（APIキー不要）＋ 座標距離からの概算フォールバック。
 * 公開サーバーが一時的に応答しない場合でも「未設定」や「並び替え前の古い値」が残らないよう、
 * タイムアウト・エラー時は2点間の直線距離（道路迂回係数1.35倍）から概ねの距離・所要時間を算出する。
 */
const ENDPOINTS: Record<RoutableMode, string> = {
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
};

const cache = new Map<string, RouteResult>();
const key = (a: LatLng, b: LatLng, m: RoutableMode) =>
  `${m}|${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

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
export function estimateRouteFallback(from: LatLng, to: LatLng, mode: RoutableMode): RouteResult {
  const distance_m = Math.max(100, Math.round(haversineMeters(from, to) * 1.35));
  // 車: 平均時速約40km (667m/分)、徒歩: 平均時速約4.2km (70m/分)
  const metersPerMin = mode === "walk" ? 70 : 667;
  const duration_minutes = Math.max(1, Math.round(distance_m / metersPerMin));
  return { duration_minutes, distance_m };
}

export class OsrmRouteProvider implements RouteProvider {
  readonly name = "OSRM (OpenStreetMap)";

  async route(from: LatLng, to: LatLng, mode: RoutableMode, signal?: AbortSignal): Promise<RouteResult> {
    const k = key(from, to, mode);
    const hit = cache.get(k);
    if (hit) return hit;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const url = `${ENDPOINTS[mode]}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`;
      const res = await fetch(url, { signal: combinedSignal });
      if (!res.ok) throw new RouteError(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        code: string;
        routes?: { duration: number; distance: number }[];
      };
      if (json.code !== "Ok" || !json.routes?.length) throw new RouteError("No route");

      const r = json.routes[0];
      const result = {
        duration_minutes: Math.max(1, Math.round(r.duration / 60)),
        distance_m: Math.round(r.distance),
      };
      cache.set(k, result);
      return result;
    } catch {
      // OSRM サーバーが応答しない・タイムアウトした場合は距離ベースの概算を必ず返す
      return estimateRouteFallback(from, to, mode);
    } finally {
      clearTimeout(timer);
    }
  }
}

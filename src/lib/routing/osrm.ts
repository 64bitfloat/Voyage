import { RouteError, type LatLng, type RoutableMode, type RouteProvider, type RouteResult } from "./types";

/**
 * OSRM（APIキー不要）。
 * project-osrm.org のデモサーバーは車のみ対応のため、車/徒歩の両方に対応する
 * FOSSGIS の公開サーバー（routing.openstreetmap.de）を既定とする。
 * 公開サーバーは利用規約上、大量アクセス不可。結果はメモリキャッシュする。
 */
const ENDPOINTS: Record<RoutableMode, string> = {
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
};

const cache = new Map<string, RouteResult>();
const key = (a: LatLng, b: LatLng, m: RoutableMode) =>
  `${m}|${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

export class OsrmRouteProvider implements RouteProvider {
  readonly name = "OSRM (OpenStreetMap)";

  async route(from: LatLng, to: LatLng, mode: RoutableMode, signal?: AbortSignal): Promise<RouteResult> {
    const k = key(from, to, mode);
    const hit = cache.get(k);
    if (hit) return hit;

    const url = `${ENDPOINTS[mode]}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new RouteError(`ルート計算に失敗しました（HTTP ${res.status}）`);
    const json = (await res.json()) as { code: string; routes?: { duration: number; distance: number }[] };
    if (json.code !== "Ok" || !json.routes?.length) throw new RouteError("ルートが見つかりませんでした");

    const r = json.routes[0];
    const result = { duration_minutes: Math.max(1, Math.round(r.duration / 60)), distance_m: Math.round(r.distance) };
    cache.set(k, result);
    return result;
  }
}

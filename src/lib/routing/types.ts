/**
 * ルート計算の抽象化。
 * 画面・スケジュール計算はこのインターフェースだけに依存する。
 * Google Maps (Routes API) へ差し替える場合は RouteProvider を実装して getRouteProvider() を変更するだけでよい。
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export type RoutableMode = "car" | "walk";

export interface RouteResult {
  duration_minutes: number;
  distance_m: number;
}

export interface RouteProvider {
  readonly name: string;
  route(from: LatLng, to: LatLng, mode: RoutableMode, signal?: AbortSignal): Promise<RouteResult>;
}

export class RouteError extends Error {}

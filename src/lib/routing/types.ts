/**
 * ルート計算の抽象化。
 * 画面・スケジュール計算はこのインターフェースだけに依存する。
 * Google Maps (Routes API) へ差し替える場合は GOOGLE_MAPS_API_KEY を設定するだけで自動切替される。
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export type RoutableMode = "car" | "walk" | "train";

export interface RouteOptions {
  /** 車移動時に高速道路・有料道路を回避するか（true = 下道のみ） */
  avoidTolls?: boolean;
  signal?: AbortSignal;
}

export interface RouteResult {
  duration_minutes: number;
  distance_m: number;
}

export interface RouteProvider {
  readonly name: string;
  route(from: LatLng, to: LatLng, mode: RoutableMode, options?: RouteOptions): Promise<RouteResult>;
}

export class RouteError extends Error {}

import { OsrmRouteProvider } from "./osrm";
import type { RouteProvider } from "./types";

export * from "./types";
export { estimateRouteFallback } from "./osrm";

let provider: RouteProvider | null = null;

/** 差し替えポイント（例: return new GoogleRoutesProvider(apiKey)） */
export function getRouteProvider(): RouteProvider {
  return (provider ??= new OsrmRouteProvider());
}

/**
 * 地名検索（Nominatim / OpenStreetMap、APIキー不要）。
 * 利用規約: 1秒1リクエストまで・自動補完での連打禁止 → 検索ボタン押下時のみ呼ぶ。
 */
export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  opening_hours?: string | null;
}

const BASE = "https://nominatim.openstreetmap.org";

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${BASE}/search?format=jsonv2&extratags=1&limit=8&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`検索に失敗しました（HTTP ${res.status}）`);
  const json = (await res.json()) as {
    name?: string;
    display_name: string;
    lat: string;
    lon: string;
    extratags?: { opening_hours?: string };
  }[];
  return json.map((r) => ({
    name: r.name || r.display_name.split(",")[0],
    address: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    opening_hours: r.extratags?.opening_hours ?? null,
  }));
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url = `${BASE}/reverse?format=jsonv2&extratags=1&accept-language=ja&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const r = (await res.json()) as {
    name?: string;
    display_name?: string;
    extratags?: { opening_hours?: string };
  };
  if (!r.display_name) return null;
  return {
    name: r.name || r.display_name.split(",")[0],
    address: r.display_name,
    lat,
    lng,
    opening_hours: r.extratags?.opening_hours ?? null,
  };
}

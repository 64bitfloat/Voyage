/**
 * 地名・住所検索（Nominatim + 国土地理院 GSI AddressSearch フォールバック、APIキー不要）。
 */
export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  opening_hours?: string | null;
}

const BASE = "https://nominatim.openstreetmap.org";
const GSI_BASE = "https://msearch.gsi.go.jp/address-search/AddressSearch";

async function searchGsi(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url = `${GSI_BASE}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    geometry?: { coordinates?: [number, number] };
    properties?: { title?: string };
  }[];
  if (!Array.isArray(json)) return [];
  return json
    .filter(
      (f) =>
        Array.isArray(f.geometry?.coordinates) &&
        f.geometry!.coordinates!.length >= 2 &&
        Number.isFinite(f.geometry!.coordinates![0]) &&
        Number.isFinite(f.geometry!.coordinates![1]),
    )
    .slice(0, 8)
    .map((f) => {
      const [lng, lat] = f.geometry!.coordinates!;
      const title = f.properties?.title || query;
      return {
        name: title,
        address: title,
        lat,
        lng,
        opening_hours: null,
      };
    });
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const url = `${BASE}/search?format=jsonv2&extratags=1&limit=8&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = (await res.json()) as {
        name?: string;
        display_name: string;
        lat: string;
        lon: string;
        extratags?: { opening_hours?: string };
      }[];
      if (json.length > 0) {
        return json.map((r) => ({
          name: r.name || r.display_name.split(",")[0],
          address: r.display_name,
          lat: Number(r.lat),
          lng: Number(r.lon),
          opening_hours: r.extratags?.opening_hours ?? null,
        }));
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    // Nominatim 失敗時は国土地理院APIへフォールバック
  }

  // 日本の番地付き住所など Nominatim でヒットしない場合は国土地理院 GSI AddressSearch で検索
  const gsi = await searchGsi(q, signal);
  if (gsi.length > 0) return gsi;

  // 末尾の番地・号を取り除いて再検索（例: "阿南町西条710" -> "阿南町西条"）
  const stripped = q.replace(/[0-9０-９\-－ー丁目番地号\s]+$/, "").trim();
  if (stripped && stripped !== q) {
    return await searchGsi(stripped, signal);
  }
  return [];
}

/**
 * 住所・施設名からベストエフォートで座標を取得する（自動補完・再計算用）。
 */
export async function geocodeSpot(
  address?: string | null,
  name?: string | null,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> {
  const candidates: string[] = [];
  const addr = address?.trim();
  if (addr) {
    const cleanAddr = addr.replace(/^〒?\s*\d{3}-?\d{4}\s*/, "").trim();
    if (cleanAddr) candidates.push(cleanAddr);
    if (addr !== cleanAddr) candidates.push(addr);
  }
  const n = name?.trim();
  if (n && !candidates.includes(n)) {
    candidates.push(n);
  }

  for (const q of candidates) {
    try {
      const res = await searchPlaces(q, signal);
      if (res.length > 0) return res[0];
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
    }
  }
  return null;
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

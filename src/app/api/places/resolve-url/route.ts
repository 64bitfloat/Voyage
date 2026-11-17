import { NextResponse } from "next/server";
import { z } from "zod";
import { parseOsmOpeningHours, type BusinessHoursRule } from "@/lib/geo/business-hours";
import { jsonError, parseBody } from "@/lib/server";

const InputSchema = z.object({
  url: z.string().trim().min(1),
});

interface ResolvedPlace {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_url: string;
  business_hours: BusinessHoursRule;
}

const NOMINATIM_HEADERS = {
  "User-Agent": "VoyageTripPlanner/1.0 (https://github.com/64bitfloat/Voyage)",
  "Accept-Language": "ja",
};

function extractFromGoogleMapsUrl(rawUrl: string): {
  name: string | null;
  lat: number | null;
  lng: number | null;
} {
  let name: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const u = new URL(rawUrl);

    // 1. /maps/place/<名称>/ または /maps/search/<名称>/
    const placeMatch = u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/);
    if (placeMatch?.[1]) {
      const decoded = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
      // 座標文字列でなければ名称として採用
      if (!/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(decoded)) {
        name = decoded;
      }
    }

    // 2. ?q=<名称 or lat,lng> / ?query=<...>
    const qParam = u.searchParams.get("q") ?? u.searchParams.get("query");
    if (qParam) {
      const coordInQ = qParam.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (coordInQ) {
        lat = Number(coordInQ[1]);
        lng = Number(coordInQ[2]);
      } else if (!name) {
        name = qParam.trim();
      }
    }

    // 3. !3d<lat>!4d<lng>（Google Maps のピン正確な座標）
    const pinMatch = rawUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (pinMatch) {
      lat = Number(pinMatch[1]);
      lng = Number(pinMatch[2]);
    }

    // 4. /@<lat>,<lng>（ビューポート中心座標）
    if (lat === null || lng === null) {
      const atMatch = rawUrl.match(/\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (atMatch) {
        lat = Number(atMatch[1]);
        lng = Number(atMatch[2]);
      }
    }
  } catch {
    // ignore URL parse errors
  }

  return { name, lat, lng };
}

/**
 * Google マップの共有リンク（短縮URL `maps.app.goo.gl/...` または通常URL）を受け取り、
 * 場所名・住所・座標・営業時間（OSM `opening_hours`）を自動取得して返す
 */
export async function POST(req: Request) {
  const parsed = await parseBody(req, InputSchema);
  if (!parsed.ok) return parsed.res;

  // 共有テキスト（例: "〇〇カフェ\nhttps://maps.app.goo.gl/xxx"）が丸ごと貼られた場合もURL部分を抽出
  const rawInput = parsed.data.url;
  const urlMatch = rawInput.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) {
    return jsonError(422, "有効なURLが見つかりませんでした");
  }
  const inputUrl = urlMatch[0];
  const prefixText = rawInput.slice(0, urlMatch.index).trim().split(/\r?\n/)[0]?.trim() || null;

  let finalUrl = inputUrl;
  try {
    // 短縮URL (maps.app.goo.gl / goo.gl) のリダイレクト先を展開
    const res = await fetch(inputUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    });
    if (res.url) finalUrl = res.url;
  } catch {
    // 展開失敗時は元のURLのまま解析を試みる
  }

  let { name, lat, lng } = extractFromGoogleMapsUrl(finalUrl);
  if (!name && prefixText) name = prefixText;

  let address: string | null = null;
  let openingHoursRaw: string | null = null;

  try {
    // A. 名称が取れている場合は Nominatim search (extratags=1) で住所・座標・opening_hours を照会
    if (name) {
      const searchUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&limit=3&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(
        name,
      )}`;
      const sRes = await fetch(searchUrl, { headers: NOMINATIM_HEADERS });
      if (sRes.ok) {
        const list = (await sRes.json()) as {
          name?: string;
          display_name?: string;
          lat?: string;
          lon?: string;
          extratags?: { opening_hours?: string };
        }[];
        if (list[0]) {
          address = list[0].display_name ?? null;
          if (lat === null && list[0].lat) lat = Number(list[0].lat);
          if (lng === null && list[0].lon) lng = Number(list[0].lon);
          openingHoursRaw = list[0].extratags?.opening_hours ?? null;
        }
      }
    }

    // B. 座標がある場合は reverse geocode でも補完
    if (lat !== null && lng !== null && (!name || !address || !openingHoursRaw)) {
      const revUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&extratags=1&accept-language=ja&lat=${lat}&lon=${lng}`;
      const rRes = await fetch(revUrl, { headers: NOMINATIM_HEADERS });
      if (rRes.ok) {
        const r = (await rRes.json()) as {
          name?: string;
          display_name?: string;
          extratags?: { opening_hours?: string };
        };
        if (!name && r.name) name = r.name;
        if (!address && r.display_name) address = r.display_name;
        if (!openingHoursRaw && r.extratags?.opening_hours) {
          openingHoursRaw = r.extratags.opening_hours;
        }
      }
    }
  } catch {
    // Nominatim 照会エラー時は URL 抽出情報のみで返却
  }

  const result: ResolvedPlace = {
    name: name || "Googleマップの地点",
    address,
    lat,
    lng,
    place_url: inputUrl,
    business_hours: parseOsmOpeningHours(openingHoursRaw),
  };

  return NextResponse.json(result);
}

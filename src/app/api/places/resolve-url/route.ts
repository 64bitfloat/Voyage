import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseJapaneseBusinessHoursFromText,
  parseOsmOpeningHours,
  type BusinessHoursRule,
} from "@/lib/geo/business-hours";
import type { SpotRow } from "@/lib/model/types";
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
  suggested_category?: SpotRow["category"];
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
      if (!/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(decoded)) {
        name = decoded;
      }
    }

    // 2. ?q=<名称 or lat,lng> / ?query=<...> (share.google のリダイレクト先もここに名称が入る)
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
 * 名称から候補クエリを生成する（例: "下條温泉郷 コスモスの湯" → ["下條温泉郷 コスモスの湯", "コスモスの湯", "下條温泉郷"]）
 */
function buildSearchCandidates(rawName: string): string[] {
  const candidates = [rawName.trim()];
  const parts = rawName
    .trim()
    .split(/[\s　・/／]+/)
    .filter((p) => p.length >= 2);
  if (parts.length >= 2) {
    // 施設固有名は末尾トークン（例: "コスモスの湯"）に来ることが多いため逆順で追加
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!candidates.includes(parts[i])) candidates.push(parts[i]);
    }
  }
  return candidates;
}

function guessCategory(name: string, osmType?: string): SpotRow["category"] | undefined {
  if (
    osmType === "public_bath" ||
    osmType === "hot_spring" ||
    /温泉|の湯|露天風呂|銭湯|スパ|サウナ/.test(name)
  ) {
    return "onsen";
  }
  if (/ホテル|旅館|キャンプ|宿|ロッジ|ペンション|ヴィラ/.test(name)) {
    return "lodging";
  }
  if (/レストラン|カフェ|食堂|そば|蕎麦|うどん|ラーメン|焼肉|寿司|居酒屋|亭|庵/.test(name)) {
    return "meal";
  }
  if (/駅|空港|インター|IC|SA|PA|サービスエリア|道の駅/.test(name)) {
    return "transport";
  }
  return undefined;
}

async function fetchWebBusinessHoursAndAddress(
  placeName: string,
): Promise<{ rule: BusinessHoursRule; address: string | null }> {
  try {
    const q = `${placeName} 営業時間 定休日`;
    const url = `https://search.yahoo.co.jp/search?p=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9",
      },
    });
    if (!res.ok) return { rule: { open: null, close: null, closedDays: [], rawText: "" }, address: null };
    const html = await res.text();
    const plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const rule = parseJapaneseBusinessHoursFromText(plain);

    // 住所がまだ取れていない場合の補助抽出（例: 長野県下伊那郡下條村睦沢3405）
    const addrMatch = plain.match(
      /(?:北海道|東京都|(?:京都|大阪)府|.{2,3}県)[^\s。、；;・|｜]{4,30}\d+(?:[-ー－]\d+)*/,
    );
    return { rule, address: addrMatch ? addrMatch[0] : null };
  } catch {
    return { rule: { open: null, close: null, closedDays: [], rawText: "" }, address: null };
  }
}

/**
 * Google マップの共有リンク（`share.google/...` / `maps.app.goo.gl/...` / 通常URL）を受け取り、
 * 場所名・住所・座標・カテゴリ・営業時間＆定休日を自動取得して返す
 */
export async function POST(req: Request) {
  const parsed = await parseBody(req, InputSchema);
  if (!parsed.ok) return parsed.res;

  const rawInput = parsed.data.url;
  const urlMatch = rawInput.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) {
    return jsonError(422, "有効なURLが見つかりませんでした");
  }
  const inputUrl = urlMatch[0];
  const prefixText =
    rawInput.slice(0, urlMatch.index).trim().split(/\r?\n/)[0]?.trim() || null;

  let finalUrl = inputUrl;
  try {
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
    // ignore redirect errors
  }

  let { name, lat, lng } = extractFromGoogleMapsUrl(finalUrl);
  if (!name && prefixText) name = prefixText;

  let address: string | null = null;
  let openingHoursRaw: string | null = null;
  let osmType: string | undefined;

  try {
    // A. 名称の候補リストで Nominatim を順に検索（「下條温泉郷 コスモスの湯」→「コスモスの湯」フォールバック）
    if (name) {
      for (const candidate of buildSearchCandidates(name)) {
        const searchUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&limit=3&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(
          candidate,
        )}`;
        const sRes = await fetch(searchUrl, { headers: NOMINATIM_HEADERS });
        if (sRes.ok) {
          const list = (await sRes.json()) as {
            name?: string;
            type?: string;
            display_name?: string;
            lat?: string;
            lon?: string;
            extratags?: { opening_hours?: string; "bath:type"?: string };
          }[];
          if (list[0]) {
            address = list[0].display_name ?? address;
            if (lat === null && list[0].lat) lat = Number(list[0].lat);
            if (lng === null && list[0].lon) lng = Number(list[0].lon);
            openingHoursRaw = list[0].extratags?.opening_hours ?? openingHoursRaw;
            osmType =
              list[0].extratags?.["bath:type"] === "onsen" ? "public_bath" : list[0].type;
            break;
          }
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
          type?: string;
          display_name?: string;
          extratags?: { opening_hours?: string };
        };
        if (!name && r.name) name = r.name;
        if (!address && r.display_name) address = r.display_name;
        if (!openingHoursRaw && r.extratags?.opening_hours) {
          openingHoursRaw = r.extratags.opening_hours;
        }
        if (!osmType && r.type) osmType = r.type;
      }
    }
  } catch {
    // ignore Nominatim errors
  }

  let businessHours = parseOsmOpeningHours(openingHoursRaw);

  // C. OSM に opening_hours が登録されていなかった場合は、Web検索結果から日本の営業時間・定休日を自動抽出
  if (name && !businessHours.open && businessHours.closedDays.length === 0) {
    const webInfo = await fetchWebBusinessHoursAndAddress(name);
    if (webInfo.rule.open || webInfo.rule.closedDays.length > 0) {
      businessHours = webInfo.rule;
    }
    if (!address && webInfo.address) {
      address = webInfo.address;
    }
  }

  const finalName = name || "Googleマップの地点";
  const result: ResolvedPlace = {
    name: finalName,
    address,
    lat,
    lng,
    place_url: inputUrl,
    suggested_category: guessCategory(finalName, osmType),
    business_hours: businessHours,
  };

  return NextResponse.json(result);
}

/**
 * 行きたい場所（候補プール day_index=0 ＋ 各Dayのスポット）から、
 * 優先度・定休日・営業時間・宿泊チェックイン時刻・移動距離（一筆書き効率）を考慮して
 * なるべく多く回れる最適な旅程を自動編成するオプティマイザ
 */
import type { DayRow, SpotRow } from "../model/types";
import { deserializeBusinessHours } from "../geo/business-hours";
import { toTokyoDate, toTokyoHHMM } from "../datetime";
import { getRouteProvider, type LatLng } from "../routing";

export interface AutoPlanSummary {
  scheduledCount: number;
  overflowCount: number;
  message: string;
}

const MIN_PER_KM_CAR = 1.4; // 直線距離からの概算（道路係数込みで約42km/h相当）
const MIN_PER_KM_WALK = 15;

/** 2点間の直線距離 (km) */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function estimateTravelMinutes(from: LatLng | null, to: LatLng | null, mode: SpotRow["transport_mode"]): number {
  if (!from || !to) return 20;
  const km = haversineKm(from, to) * 1.3; // 道路迂回係数 1.3
  const rate = mode === "walk" ? MIN_PER_KM_WALK : MIN_PER_KM_CAR;
  return Math.max(5, Math.round(km * rate));
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** スポットの優先度スコア（高いほど優先して旅程に組み込む） */
export function spotPriorityScore(s: SpotRow): number {
  let score = 0;
  if (s.is_main) score += 100;
  if (s.status === "decided") score += 60;
  else if (s.status === "candidate") score += 30;
  else score += 10;
  if (s.is_fixed && s.reservation_time) score += 80;
  return score;
}

/** 指定された日付（YYYY-MM-DD）がそのスポットの定休日かどうか */
function isClosedOnDate(spot: SpotRow, dateStr: string | null): boolean {
  if (!dateStr) return false;
  const bh = deserializeBusinessHours(spot.transport_note);
  if (bh.closedDays.length === 0) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return bh.closedDays.includes(dow);
}

/**
 * 指定された時刻（分）から滞在した場合に営業時間内に収まるか、
 * 開店前なら開店時刻まで待った開始時刻（分）を返す。営業時間外（閉店後）なら null を返す。
 */
function fitWithinBusinessHours(
  spot: SpotRow,
  arrivalMin: number,
): { startMin: number; departMin: number } | null {
  const bh = deserializeBusinessHours(spot.transport_note);
  let startMin = arrivalMin;

  // 固定予約・行きたい時刻が指定されている場合
  if (spot.is_fixed && spot.reservation_time) {
    const resMin = hhmmToMin(toTokyoHHMM(spot.reservation_time));
    // 予約時刻に15分以上遅れる場合は不可
    if (arrivalMin > resMin + 15) return null;
    startMin = Math.max(arrivalMin, resMin);
  }

  if (bh.open) {
    const openMin = hhmmToMin(bh.open);
    if (startMin < openMin) {
      // 開店まで60分以内の待ちなら待って入店、それ以上早すぎる場合は今は別のスポットを先にする
      if (openMin - startMin <= 60) {
        startMin = openMin;
      } else {
        return null;
      }
    }
  }

  const departMin = startMin + spot.stay_minutes;
  if (bh.close) {
    const closeMin = hhmmToMin(bh.close);
    if (closeMin >= (bh.open ? hhmmToMin(bh.open) : 0) && departMin > closeMin) {
      return null;
    }
  }

  return { startMin, departMin };
}

/**
 * すべてのスポット（候補プール day_index===0 を含む）から、
 * Day 1..N の最適ルートを自動編成して新しい SpotRow[] を返す
 */
export async function autoBuildEfficientItinerary(
  days: DayRow[],
  allSpots: SpotRow[],
  includeAlreadyAssigned = true,
): Promise<{ spots: SpotRow[]; summary: AutoPlanSummary }> {
  const tripDays = days.filter((d) => d.day_index >= 1).sort((a, b) => a.day_index - b.day_index);
  if (tripDays.length === 0) {
    return {
      spots: allSpots,
      summary: { scheduledCount: 0, overflowCount: 0, message: "日程がありません" },
    };
  }

  // 宿泊スポットは日付（check_in日 または既存の day_index）を固定アンカーとして扱う
  const lodgingSpots = allSpots.filter((s) => s.category === "lodging");
  const normalSpots = allSpots.filter((s) => s.category !== "lodging");

  // 自動編成対象のプール（includeAlreadyAssigned=true なら全スポットを最適再配置、false なら候補プール day_index===0 のみ追加配置）
  const fixedDaySpotsMap = new Map<number, SpotRow[]>();
  for (const d of tripDays) fixedDaySpotsMap.set(d.day_index, []);

  const pool: SpotRow[] = [];
  for (const s of normalSpots) {
    if (includeAlreadyAssigned || s.day_index === 0) {
      pool.push({ ...s });
    } else {
      const arr = fixedDaySpotsMap.get(s.day_index) ?? [];
      arr.push({ ...s });
      fixedDaySpotsMap.set(s.day_index, arr);
    }
  }

  // 宿泊スポットを該当Dayに割り当て（check_inの日付が一致するDayがあればそこへ、なければ既存のday_indexまたはDay1へ）
  const lodgingByDay = new Map<number, SpotRow>();
  for (const l of lodgingSpots) {
    let targetDayIdx = l.day_index >= 1 ? l.day_index : 1;
    if (l.check_in) {
      const ciDate = toTokyoDate(new Date(l.check_in));
      const matched = tripDays.find((d) => d.date === ciDate);
      if (matched) targetDayIdx = matched.day_index;
    }
    lodgingByDay.set(targetDayIdx, { ...l, day_index: targetDayIdx });
  }

  const remaining = new Set<string>(pool.map((s) => s.id));
  const poolById = new Map<string, SpotRow>(pool.map((s) => [s.id, s]));
  const resultSpots: SpotRow[] = [];
  let scheduledCount = 0;

  for (let di = 0; di < tripDays.length; di++) {
    const day = tripDays[di];
    const prevDayLodging = di > 0 ? lodgingByDay.get(tripDays[di - 1].day_index) : undefined;
    const tonightLodging = lodgingByDay.get(day.day_index);

    // その日の開始時刻（分）と開始座標
    let cursorMin = day.departure_time
      ? hhmmToMin(day.departure_time)
      : prevDayLodging?.check_out
        ? hhmmToMin(toTokyoHHMM(prevDayLodging.check_out))
        : 8 * 60 + 30;

    let currentCoords: LatLng | null =
      day.departure_lat !== null && day.departure_lng !== null
        ? { lat: day.departure_lat, lng: day.departure_lng }
        : prevDayLodging && prevDayLodging.lat !== null && prevDayLodging.lng !== null
          ? { lat: prevDayLodging.lat, lng: prevDayLodging.lng }
          : null;

    // その日の活動終了リミット（宿泊のチェックイン予定時刻、なければ 20:30）
    const dayEndLimitMin = tonightLodging?.check_in
      ? Math.max(cursorMin + 120, hhmmToMin(toTokyoHHMM(tonightLodging.check_in)))
      : 20 * 60 + 30;

    const chosenForDay: SpotRow[] = [...(fixedDaySpotsMap.get(day.day_index) ?? [])];

    // 貪欲＋優先度・距離・時間帯スコアリングで1スポットずつ順番に組み込む
    while (remaining.size > 0) {
      let bestSpot: SpotRow | null = null;
      let bestScore = -Infinity;
      let bestDepartMin = cursorMin;
      let bestTravelMin = 20;

      for (const id of remaining) {
        const cand = poolById.get(id)!;

        // 定休日の日はスキップ
        if (isClosedOnDate(cand, day.date)) continue;

        const candCoords: LatLng | null =
          cand.lat !== null && cand.lng !== null ? { lat: cand.lat, lng: cand.lng } : null;
        const travelMin =
          cand.transport_duration_minutes ??
          estimateTravelMinutes(currentCoords, candCoords, cand.transport_mode ?? "car");
        const arrivalMin = cursorMin + travelMin;

        // 営業時間・予約時刻との適合チェック
        const fit = fitWithinBusinessHours(cand, arrivalMin);
        if (!fit) continue;

        // このスポットに寄ったあと、今夜の宿（または1日の終了リミット）に間に合うか
        const toLodgingMin =
          tonightLodging && tonightLodging.lat !== null && tonightLodging.lng !== null && candCoords
            ? estimateTravelMinutes(
                candCoords,
                { lat: tonightLodging.lat, lng: tonightLodging.lng },
                "car",
              )
            : 0;
        if (fit.departMin + toLodgingMin > dayEndLimitMin + 30) {
          continue;
        }

        // スコア計算:
        //   基本優先度（メイン・決定・候補）
        //   − 移動時間ペナルティ（近い場所ほど高スコア＝効率的なルート）
        //   ＋ 食事ボーナス（昼11:00〜13:30、夜17:00〜19:30に食事カテゴリが来ると加点）
        let score = spotPriorityScore(cand) * 2 - travelMin * 1.5;

        if (cand.category === "meal") {
          const isLunchWindow = fit.startMin >= 11 * 60 && fit.startMin <= 13 * 60 + 45;
          const isDinnerWindow = fit.startMin >= 17 * 60 && fit.startMin <= 20 * 60;
          if (isLunchWindow || isDinnerWindow) score += 45;
          else score -= 25;
        }

        if (cand.category === "onsen" && fit.startMin >= 14 * 60) {
          // 温泉は午後〜夕方に寄ると自然な流れになるよう微加点
          score += 15;
        }

        if (score > bestScore) {
          bestScore = score;
          bestSpot = cand;
          bestDepartMin = fit.departMin;
          bestTravelMin = travelMin;
        }
      }

      if (!bestSpot) break;

      remaining.delete(bestSpot.id);
      scheduledCount++;
      chosenForDay.push({
        ...bestSpot,
        day_index: day.day_index,
        sort_order: chosenForDay.length,
        transport_mode: bestSpot.transport_mode ?? "car",
        transport_duration_minutes: bestSpot.transport_duration_minutes ?? bestTravelMin,
      });
      cursorMin = bestDepartMin;
      if (bestSpot.lat !== null && bestSpot.lng !== null) {
        currentCoords = { lat: bestSpot.lat, lng: bestSpot.lng };
      }
    }

    // その日の最後に宿泊スポットを追加
    if (tonightLodging) {
      const lCoords =
        tonightLodging.lat !== null && tonightLodging.lng !== null
          ? { lat: tonightLodging.lat, lng: tonightLodging.lng }
          : null;
      const toLMin =
        tonightLodging.transport_duration_minutes ??
        estimateTravelMinutes(currentCoords, lCoords, tonightLodging.transport_mode ?? "car");
      chosenForDay.push({
        ...tonightLodging,
        day_index: day.day_index,
        sort_order: chosenForDay.length,
        transport_mode: tonightLodging.transport_mode ?? "car",
        transport_duration_minutes: toLMin,
      });
    }

    // 最後に OSRM で実ルート移動時間・距離を精密更新
    let prev: LatLng | null =
      day.departure_lat !== null && day.departure_lng !== null
        ? { lat: day.departure_lat, lng: day.departure_lng }
        : prevDayLodging && prevDayLodging.lat !== null && prevDayLodging.lng !== null
          ? { lat: prevDayLodging.lat, lng: prevDayLodging.lng }
          : null;

    for (let i = 0; i < chosenForDay.length; i++) {
      const s = chosenForDay[i];
      s.sort_order = i;
      if (
        prev &&
        s.lat !== null &&
        s.lng !== null &&
        (s.transport_mode === "car" || s.transport_mode === "walk")
      ) {
        try {
          const r = await getRouteProvider().route(prev, { lat: s.lat, lng: s.lng }, s.transport_mode);
          s.transport_duration_minutes = r.duration_minutes;
          s.transport_distance_m = r.distance_m;
        } catch {
          // keep estimated duration
        }
      }
      if (s.lat !== null && s.lng !== null) {
        prev = { lat: s.lat, lng: s.lng };
      }
      resultSpots.push(s);
    }
  }

  // 時間内に収まらなかったスポットは候補プール（day_index = 0）に残す
  let poolOrder = 0;
  for (const id of remaining) {
    const s = poolById.get(id)!;
    resultSpots.push({
      ...s,
      day_index: 0,
      sort_order: poolOrder++,
    });
  }

  const overflowCount = remaining.size;
  const message =
    overflowCount === 0
      ? `✨ 全 ${scheduledCount} カ所のスポットを優先度・営業時間・移動効率に合わせて自動編成しました！`
      : `✨ 優先度の高い ${scheduledCount} カ所を旅程に組み込みました（時間に収まらない ${overflowCount} カ所は「候補プール」に残しています）`;

  return {
    spots: resultSpots,
    summary: { scheduledCount, overflowCount, message },
  };
}

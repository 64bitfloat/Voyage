/**
 * 行きたい場所（候補プール day_index=0 ＋ 各Dayのスポット）から、
 * - 「枠タグ（例: 1日目昼食 / 2日目温泉）」による「どっちか1つ選抜」＆「複数枠への振り分け」
 * - 優先度（★メイン / 決まった / 候補 / 未定）
 * - 定休日・営業時間・枠タグの時間帯（windowStart〜windowEnd）
 * - 宿泊チェックイン時刻・移動距離（一筆書き効率）
 * をすべて考慮して最適な旅程を自動編成するオプティマイザ
 */
import type { DayRow, SpotRow } from "../model/types";
import { deserializeBusinessHours, type ChoiceSlotTag } from "../geo/business-hours";
import { toTokyoDate, toTokyoHHMM } from "../datetime";
import { getRouteProvider, type LatLng } from "../routing";

export interface AutoPlanSummary {
  scheduledCount: number;
  overflowCount: number;
  message: string;
}

const MIN_PER_KM_CAR = 1.4;
const MIN_PER_KM_WALK = 15;

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

function estimateTravelMinutes(
  from: LatLng | null,
  to: LatLng | null,
  mode: SpotRow["transport_mode"],
): number {
  if (!from || !to) return 20;
  const km = haversineKm(from, to) * 1.3;
  const rate = mode === "walk" ? MIN_PER_KM_WALK : MIN_PER_KM_CAR;
  return Math.max(5, Math.round(km * rate));
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function spotPriorityScore(s: SpotRow): number {
  let score = 0;
  if (s.is_main) score += 100;
  if (s.status === "decided") score += 60;
  else if (s.status === "candidate") score += 30;
  else score += 10;
  if (s.is_fixed && s.reservation_time) score += 80;
  return score;
}

function isClosedOnDate(spot: SpotRow, dateStr: string | null): boolean {
  if (!dateStr) return false;
  const bh = deserializeBusinessHours(spot.transport_note);
  if (bh.closedDays.length === 0) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return bh.closedDays.includes(dow);
}

function fitWithinBusinessHours(
  spot: SpotRow,
  arrivalMin: number,
  slotTag?: ChoiceSlotTag,
): { startMin: number; departMin: number } | null {
  const bh = deserializeBusinessHours(spot.transport_note);
  let startMin = arrivalMin;

  // 枠タグ（例: 1日目昼食 11:30〜13:30）が指定されている場合、その枠の開始〜終了時間帯に合わせる
  if (slotTag) {
    const wStart = hhmmToMin(slotTag.windowStart);
    const wEnd = hhmmToMin(slotTag.windowEnd);
    // 枠の開始時刻より前に到着できる場合は、枠開始時刻（wStart）にスケジュールする
    if (startMin < wStart) {
      startMin = wStart;
    }
    // 枠の終了時刻を30分以上過ぎてしまう場合はこの枠には入らない
    if (startMin > wEnd + 30) {
      return null;
    }
  }

  if (spot.is_fixed && spot.reservation_time) {
    const resMin = hhmmToMin(toTokyoHHMM(spot.reservation_time));
    if (arrivalMin > resMin + 15) return null;
    startMin = Math.max(startMin, resMin);
  }

  if (bh.open) {
    const openMin = hhmmToMin(bh.open);
    if (startMin < openMin) {
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
 * 枠タグ（「1日目昼食」「2日目温泉」等の択一・振り分け枠）と移動効率を考慮して自動編成する
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

  const lodgingSpots = allSpots.filter((s) => s.category === "lodging");
  const normalSpots = allSpots.filter((s) => s.category !== "lodging");

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
  // 既に埋まった枠タグID（例: "day1-lunch" に1つ採用されたら、他の "day1-lunch" 専用の候補は採用しない）
  const filledSlotIds = new Set<string>();

  const resultSpots: SpotRow[] = [];
  let scheduledCount = 0;

  for (let di = 0; di < tripDays.length; di++) {
    const day = tripDays[di];
    const prevDayLodging = di > 0 ? lodgingByDay.get(tripDays[di - 1].day_index) : undefined;
    const tonightLodging = lodgingByDay.get(day.day_index);

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

    const dayEndLimitMin = tonightLodging?.check_in
      ? Math.max(cursorMin + 120, hhmmToMin(toTokyoHHMM(tonightLodging.check_in)))
      : 20 * 60 + 30;

    const chosenForDay: SpotRow[] = [...(fixedDaySpotsMap.get(day.day_index) ?? [])];

    while (remaining.size > 0) {
      let bestSpot: SpotRow | null = null;
      let bestScore = -Infinity;
      let bestDepartMin = cursorMin;
      let bestTravelMin = 20;
      let bestUsedSlotId: string | null = null;

      for (const id of remaining) {
        const cand = poolById.get(id)!;
        if (isClosedOnDate(cand, day.date)) continue;

        const bh = deserializeBusinessHours(cand.transport_note);
        const slotTags = bh.slotTags ?? [];

        const candCoords: LatLng | null =
          cand.lat !== null && cand.lng !== null ? { lat: cand.lat, lng: cand.lng } : null;
        const travelMin =
          cand.transport_duration_minutes ??
          estimateTravelMinutes(currentCoords, candCoords, cand.transport_mode ?? "car");
        const arrivalMin = cursorMin + travelMin;

        const toLodgingMin =
          tonightLodging && tonightLodging.lat !== null && tonightLodging.lng !== null && candCoords
            ? estimateTravelMinutes(
                candCoords,
                { lat: tonightLodging.lat, lng: tonightLodging.lng },
                "car",
              )
            : 0;

        // ケースA: 枠タグ（例: 「1日目昼食」「1日目夕食」など）が設定されているスポット
        if (slotTags.length > 0) {
          // この日（day.day_index）に該当し、かつまだ埋まっていない枠タグだけを試す
          const availableSlotsForToday = slotTags.filter(
            (st) =>
              !filledSlotIds.has(st.id) &&
              (st.dayIndex === null || st.dayIndex === day.day_index),
          );
          if (availableSlotsForToday.length === 0) continue;

          for (const st of availableSlotsForToday) {
            const fit = fitWithinBusinessHours(cand, arrivalMin, st);
            if (!fit) continue;
            if (fit.departMin + toLodgingMin > dayEndLimitMin + 30) continue;

            const wStart = hhmmToMin(st.windowStart);
            const wEnd = hhmmToMin(st.windowEnd);
            const inIdealWindow = fit.startMin >= wStart && fit.startMin <= wEnd;
            const waitMin = Math.max(0, fit.startMin - arrivalMin);

            // 近い時間帯の枠（朝→昼→夕の順）から順番に選ばれるよう waitMin ペナルティを付与し、
            // 同じ枠内では優先度が高く移動ロスが少ない1軒を選抜する
            const score =
              spotPriorityScore(cand) * 2 +
              (inIdealWindow ? 120 : 20) -
              travelMin * 1.5 -
              waitMin * 0.4;

            if (score > bestScore) {
              bestScore = score;
              bestSpot = cand;
              bestDepartMin = fit.departMin;
              bestTravelMin = travelMin;
              bestUsedSlotId = st.id;
            }
          }
          continue;
        }

        // ケースB: 枠タグが設定されていない一般スポット
        const fit = fitWithinBusinessHours(cand, arrivalMin);
        if (!fit) continue;
        if (fit.departMin + toLodgingMin > dayEndLimitMin + 30) continue;

        let score = spotPriorityScore(cand) * 2 - travelMin * 1.5;

        if (cand.category === "meal") {
          const isLunchWindow = fit.startMin >= 11 * 60 && fit.startMin <= 13 * 60 + 45;
          const isDinnerWindow = fit.startMin >= 17 * 60 && fit.startMin <= 20 * 60;
          if (isLunchWindow || isDinnerWindow) score += 45;
          else score -= 25;
        }

        if (cand.category === "onsen" && fit.startMin >= 14 * 60) {
          score += 15;
        }

        if (score > bestScore) {
          bestScore = score;
          bestSpot = cand;
          bestDepartMin = fit.departMin;
          bestTravelMin = travelMin;
          bestUsedSlotId = null;
        }
      }

      if (!bestSpot) break;

      remaining.delete(bestSpot.id);
      if (bestUsedSlotId) {
        filledSlotIds.add(bestUsedSlotId);
      }
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
          const r = await getRouteProvider().route(
            prev,
            { lat: s.lat, lng: s.lng },
            s.transport_mode,
          );
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
  const slotNote = filledSlotIds.size > 0 ? `（枠タグ ${filledSlotIds.size} 枠を最適選抜）` : "";
  const message =
    overflowCount === 0
      ? `✨ 全 ${scheduledCount} カ所を自動編成しました！${slotNote}`
      : `✨ ${scheduledCount} カ所を旅程に採用しました${slotNote}（別候補・時間外の ${overflowCount} カ所は「候補プール」に控えています）`;

  return {
    spots: resultSpots,
    summary: { scheduledCount, overflowCount, message },
  };
}

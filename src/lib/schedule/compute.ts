/**
 * タイムライン計算とスケジュール破綻検知（第3章）
 * 純粋関数のみ。地図・ネットワーク・DBに依存しない。
 *
 * ルール:
 *   到着 = 前の出発（その日の最初は出発時刻。前日からの宿泊チェックアウトがある日はチェックアウト時刻を基準）＋ 移動時間
 *   予約固定のスポットで到着が予約より早い → 予約時刻まで待ち、予約時刻から滞在開始
 *   予約固定のスポットで到着が予約より遅い → 破綻（超過分数を記録）、到着時刻から滞在開始
 *   宿泊スポット（check_in 設定あり） → チェックイン時刻を基準に開始。チェックアウトが翌日以降なら滞在時間を加算せずチェックインでその日の移動を終える
 *   出発 = 滞在開始 ＋ 滞在時間
 */
import { combineDateTime, toTokyoDate, toTokyoISO } from "../datetime";
import type { DayRow, SpotRow } from "../model/types";
import type { ScheduleConflict } from "../export/schema";

export interface SpotTiming {
  arrival: string | null;
  departure: string | null;
  /** 予約時刻まで待つ分数 */
  wait_minutes: number;
  /** 予約に間に合わない分数（0 = 問題なし） */
  overrun_minutes: number;
  /** 移動時間が未計算のため0分として扱った */
  travel_unknown: boolean;
}

export interface DaySchedule {
  timings: Record<string, SpotTiming>;
  conflicts: ScheduleConflict[];
  /** その日の最終出発時刻 */
  end: string | null;
  /** 日付または出発時刻が未設定で計算できない */
  incomplete: boolean;
  /** 前日以前にチェックインし、この日にチェックアウトする宿泊スポット（日跨ぎ表示用） */
  checkoutSpot: SpotRow | null;
}

const MIN = 60_000;

export function computeDaySchedule(
  day: DayRow,
  orderedSpots: SpotRow[],
  checkoutSpot: SpotRow | null = null,
): DaySchedule {
  const timings: Record<string, SpotTiming> = {};
  const conflicts: ScheduleConflict[] = [];

  if (!day.date || (!day.departure_time && !checkoutSpot?.check_out)) {
    for (const s of orderedSpots)
      timings[s.id] = { arrival: null, departure: null, wait_minutes: 0, overrun_minutes: 0, travel_unknown: false };
    return { timings, conflicts, end: null, incomplete: true, checkoutSpot };
  }

  // チェックアウトスポットがこの日に設定されており、出発地点が未指定の場合はチェックアウト時刻から1日の行程を開始する
  let cursor =
    checkoutSpot?.check_out && !day.departure_point
      ? Date.parse(checkoutSpot.check_out)
      : Date.parse(combineDateTime(day.date, day.departure_time ?? "08:00"));

  for (const s of orderedSpots) {
    const travel = s.transport_duration_minutes;
    let arrival = cursor + (travel ?? 0) * MIN;
    let start = arrival;
    let wait = 0;
    let overrun = 0;

    // 宿泊スポットで check_in が設定されている場合
    if (s.category === "lodging" && s.check_in) {
      const ci = Date.parse(s.check_in);
      if (travel === null) {
        arrival = ci;
        start = ci;
      } else if (arrival < ci) {
        wait = Math.round((ci - arrival) / MIN);
        start = ci;
      }
      // チェックアウトが同日の場合はチェックアウト時刻を出発時刻とし、翌日以降（日跨ぎ）の場合はチェックイン時刻でその日の行程を終了する
      let departure = start;
      if (s.check_out) {
        const coDate = toTokyoDate(new Date(s.check_out));
        if (coDate === day.date) {
          departure = Math.max(start, Date.parse(s.check_out));
        }
      }
      const arrivalIso = toTokyoISO(new Date(start));
      timings[s.id] = {
        arrival: arrivalIso,
        departure: toTokyoISO(new Date(departure)),
        wait_minutes: wait,
        overrun_minutes: 0,
        travel_unknown: travel === null,
      };
      cursor = departure;
      continue;
    }

    if (s.is_fixed && s.reservation_time) {
      const res = Date.parse(s.reservation_time);
      if (arrival > res) {
        overrun = Math.round((arrival - res) / MIN);
      } else {
        wait = Math.round((res - arrival) / MIN);
        start = res;
      }
    }

    const departure = start + s.stay_minutes * MIN;
    const arrivalIso = toTokyoISO(new Date(arrival));
    timings[s.id] = {
      arrival: arrivalIso,
      departure: toTokyoISO(new Date(departure)),
      wait_minutes: wait,
      overrun_minutes: overrun,
      travel_unknown: travel === null,
    };
    if (overrun > 0 && s.reservation_time) {
      conflicts.push({
        spot_id: s.id,
        spot_name: s.name,
        reservation_time: toTokyoISO(new Date(s.reservation_time)),
        arrival_planned: arrivalIso,
        overrun_minutes: overrun,
      });
    }
    cursor = departure;
  }

  return { timings, conflicts, end: toTokyoISO(new Date(cursor)), incomplete: false, checkoutSpot };
}

/**
 * 指定された日（day）にチェックアウト日を迎える日跨ぎ宿泊スポットを返す
 */
export function findCheckoutSpotForDay(day: DayRow, allSpots: SpotRow[]): SpotRow | null {
  if (!day.date) return null;
  for (const s of allSpots) {
    if (s.category !== "lodging" || !s.check_out) continue;
    const coDate = toTokyoDate(new Date(s.check_out));
    const ciDate = s.check_in ? toTokyoDate(new Date(s.check_in)) : null;
    // チェックアウト日がこの日の日付と一致し、かつ別の日（または前日以前）にチェックインしたスポット
    if (coDate === day.date && (s.day_index !== day.day_index || (ciDate && ciDate !== coDate))) {
      return s;
    }
  }
  return null;
}

/** 全日程分をまとめて計算 */
export function computeTripSchedule(days: DayRow[], spots: SpotRow[]) {
  const byDay = new Map<number, DaySchedule>();
  for (const d of days) {
    const coSpot = findCheckoutSpotForDay(d, spots);
    byDay.set(d.day_index, computeDaySchedule(d, spotsOfDay(spots, d.day_index), coSpot));
  }
  const conflicts = [...byDay.values()].flatMap((d) => d.conflicts);
  return { byDay, conflicts };
}

export function spotsOfDay(spots: SpotRow[], dayIndex: number): SpotRow[] {
  return spots.filter((s) => s.day_index === dayIndex).sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * タイムライン計算とスケジュール破綻検知（第3章）
 * 純粋関数のみ。地図・ネットワーク・DBに依存しない。
 *
 * ルール:
 *   到着 = 前の出発（その日の最初は出発時刻）＋ 移動時間
 *   予約固定のスポットで到着が予約より早い → 予約時刻まで待ち、予約時刻から滞在開始
 *   予約固定のスポットで到着が予約より遅い → 破綻（超過分数を記録）、到着時刻から滞在開始
 *   出発 = 滞在開始 ＋ 滞在時間
 */
import { combineDateTime, toTokyoISO } from "../datetime";
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
}

const MIN = 60_000;

export function computeDaySchedule(day: DayRow, orderedSpots: SpotRow[]): DaySchedule {
  const timings: Record<string, SpotTiming> = {};
  const conflicts: ScheduleConflict[] = [];

  if (!day.date || !day.departure_time) {
    for (const s of orderedSpots)
      timings[s.id] = { arrival: null, departure: null, wait_minutes: 0, overrun_minutes: 0, travel_unknown: false };
    return { timings, conflicts, end: null, incomplete: true };
  }

  let cursor = Date.parse(combineDateTime(day.date, day.departure_time));

  for (const s of orderedSpots) {
    const travel = s.transport_duration_minutes;
    const arrival = cursor + (travel ?? 0) * MIN;
    let start = arrival;
    let wait = 0;
    let overrun = 0;

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

  return { timings, conflicts, end: toTokyoISO(new Date(cursor)), incomplete: false };
}

/** 全日程分をまとめて計算 */
export function computeTripSchedule(days: DayRow[], spots: SpotRow[]) {
  const byDay = new Map<number, DaySchedule>();
  for (const d of days) byDay.set(d.day_index, computeDaySchedule(d, spotsOfDay(spots, d.day_index)));
  const conflicts = [...byDay.values()].flatMap((d) => d.conflicts);
  return { byDay, conflicts };
}

export function spotsOfDay(spots: SpotRow[], dayIndex: number): SpotRow[] {
  return spots.filter((s) => s.day_index === dayIndex).sort((a, b) => a.sort_order - b.sort_order);
}

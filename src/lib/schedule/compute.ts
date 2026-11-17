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
import { combineDateTime, toTokyoDate, toTokyoHHMM, toTokyoISO } from "../datetime";
import { deserializeBusinessHours } from "../geo/business-hours";
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
  /** 「何時までに前の場所を出ればOKか」の逆算タイムリミット（HH:MM） */
  must_leave_prev_by: string | null;
  /** 逆算タイムリミットの理由（例: "12:00予約" / "20:00閉店"） */
  leave_by_reason: string | null;
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

function computeBackwardDeadlines(
  dayDate: string,
  orderedSpots: SpotRow[],
): Record<string, { must_leave_prev_by: string | null; leave_by_reason: string | null }> {
  const result: Record<string, { must_leave_prev_by: string | null; leave_by_reason: string | null }> =
    {};
  let nextLeaveMs: number | null = null;
  let nextReason: string | null = null;

  for (let i = orderedSpots.length - 1; i >= 0; i--) {
    const spot = orderedSpots[i];
    const travelMs = (spot.transport_duration_minutes ?? 0) * MIN;
    const bh = deserializeBusinessHours(spot.transport_note);

    let ownMaxArrivalMs: number | null = null;
    let ownReason: string | null = null;

    if (spot.is_fixed && spot.reservation_time) {
      ownMaxArrivalMs = Date.parse(spot.reservation_time);
      ownReason = `${toTokyoHHMM(spot.reservation_time)}着`;
    } else if (spot.category === "lodging" && spot.check_in) {
      ownMaxArrivalMs = Date.parse(spot.check_in);
      ownReason = `${toTokyoHHMM(spot.check_in)}チェックイン`;
    } else if (bh.targetTime) {
      ownMaxArrivalMs = Date.parse(combineDateTime(dayDate, bh.targetTime));
      ownReason = `目安 ${bh.targetTime}`;
    } else if (bh.close) {
      const closeIso = combineDateTime(dayDate, bh.close);
      ownMaxArrivalMs = Date.parse(closeIso) - spot.stay_minutes * MIN;
      ownReason = `${bh.close}閉店（滞在${spot.stay_minutes}分）`;
    }

    let propagatedMaxArrivalMs: number | null = null;
    if (nextLeaveMs !== null) {
      // 日跨ぎ宿泊のチェックインは当日滞在時間を逆算しない
      const isOvernightLodging =
        spot.category === "lodging" &&
        spot.check_out &&
        toTokyoDate(new Date(spot.check_out)) !== dayDate;
      if (!isOvernightLodging) {
        propagatedMaxArrivalMs = nextLeaveMs - spot.stay_minutes * MIN;
      }
    }

    let effectiveMaxArrivalMs: number | null = null;
    let effectiveReason: string | null = null;
    if (ownMaxArrivalMs !== null && propagatedMaxArrivalMs !== null) {
      if (propagatedMaxArrivalMs <= ownMaxArrivalMs) {
        effectiveMaxArrivalMs = propagatedMaxArrivalMs;
        effectiveReason = nextReason;
      } else {
        effectiveMaxArrivalMs = ownMaxArrivalMs;
        effectiveReason = ownReason;
      }
    } else if (ownMaxArrivalMs !== null) {
      effectiveMaxArrivalMs = ownMaxArrivalMs;
      effectiveReason = ownReason;
    } else if (propagatedMaxArrivalMs !== null) {
      effectiveMaxArrivalMs = propagatedMaxArrivalMs;
      effectiveReason = nextReason;
    }

    if (effectiveMaxArrivalMs !== null) {
      const leavePrevMs: number = effectiveMaxArrivalMs - travelMs;
      result[spot.id] = {
        must_leave_prev_by: toTokyoHHMM(toTokyoISO(new Date(leavePrevMs))),
        leave_by_reason: effectiveReason,
      };
      nextLeaveMs = leavePrevMs;
      nextReason = effectiveReason;
    } else {
      result[spot.id] = { must_leave_prev_by: null, leave_by_reason: null };
      nextLeaveMs = null;
      nextReason = null;
    }
  }

  return result;
}

export function computeDaySchedule(
  day: DayRow,
  orderedSpots: SpotRow[],
  checkoutSpot: SpotRow | null = null,
): DaySchedule {
  const timings: Record<string, SpotTiming> = {};
  const conflicts: ScheduleConflict[] = [];
  const baseDate = day.date ?? "2026-01-01";
  const deadlines = computeBackwardDeadlines(baseDate, orderedSpots);

  const incomplete = !day.date || (!day.departure_time && !checkoutSpot?.check_out);

  // チェックアウトスポットがこの日に設定されている場合は、予定チェックアウト時刻を最優先し、なければ出発時刻から開始。
  // 出発時刻が未設定でも、固定予約や宿泊チェックインがあればその時刻以降は表示する。
  let cursor: number | null = checkoutSpot?.check_out
    ? Date.parse(checkoutSpot.check_out)
    : day.date && day.departure_time
      ? Date.parse(combineDateTime(day.date, day.departure_time))
      : null;

  for (const s of orderedSpots) {
    const travel = s.transport_duration_minutes;
    const deadline = deadlines[s.id] ?? { must_leave_prev_by: null, leave_by_reason: null };

    // 宿泊スポットで check_in が設定されている場合
    if (s.category === "lodging" && s.check_in) {
      const ci = Date.parse(s.check_in);
      let arrival = cursor !== null ? cursor + (travel ?? 0) * MIN : ci;
      let start = arrival;
      let wait = 0;
      let overrun = 0;

      if (cursor === null || travel === null) {
        arrival = ci;
        start = ci;
      } else if (arrival < ci) {
        wait = Math.round((ci - arrival) / MIN);
        start = ci;
      } else if (arrival > ci) {
        overrun = Math.round((arrival - ci) / MIN);
      }

      // チェックアウトが同日の場合はチェックアウト時刻を出発時刻とし、翌日以降（日跨ぎ）の場合はチェックイン時刻でその日の行程を終了する
      let departure = start;
      if (s.check_out && day.date) {
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
        overrun_minutes: overrun,
        travel_unknown: travel === null,
        ...deadline,
      };
      cursor = departure;
      continue;
    }

    if (s.is_fixed && s.reservation_time) {
      const res = Date.parse(s.reservation_time);
      const arrival = cursor !== null ? cursor + (travel ?? 0) * MIN : res;
      let start = arrival;
      let wait = 0;
      let overrun = 0;

      if (cursor !== null) {
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
        ...deadline,
      };
      if (overrun > 0) {
        conflicts.push({
          spot_id: s.id,
          spot_name: s.name,
          reservation_time: toTokyoISO(new Date(s.reservation_time)),
          arrival_planned: arrivalIso,
          overrun_minutes: overrun,
        });
      }
      cursor = departure;
      continue;
    }

    if (cursor === null) {
      const bh = deserializeBusinessHours(s.transport_note);
      if (bh.targetTime && day.date) {
        const targetMs = Date.parse(combineDateTime(day.date, bh.targetTime));
        const departureMs = targetMs + s.stay_minutes * MIN;
        timings[s.id] = {
          arrival: toTokyoISO(new Date(targetMs)),
          departure: toTokyoISO(new Date(departureMs)),
          wait_minutes: 0,
          overrun_minutes: 0,
          travel_unknown: travel === null,
          ...deadline,
        };
        cursor = departureMs;
        continue;
      }
      timings[s.id] = {
        arrival: null,
        departure: null,
        wait_minutes: 0,
        overrun_minutes: 0,
        travel_unknown: false,
        ...deadline,
      };
      continue;
    }

    const arrival = cursor + (travel ?? 0) * MIN;
    const departure = arrival + s.stay_minutes * MIN;
    timings[s.id] = {
      arrival: toTokyoISO(new Date(arrival)),
      departure: toTokyoISO(new Date(departure)),
      wait_minutes: 0,
      overrun_minutes: 0,
      travel_unknown: travel === null,
      ...deadline,
    };
    cursor = departure;
  }

  return {
    timings,
    conflicts,
    end: !incomplete && cursor !== null ? toTokyoISO(new Date(cursor)) : null,
    incomplete,
    checkoutSpot,
  };
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

/**
 * 内部状態（TripDoc）から Muse 連携用 JSON（VoyageExport）への変換。
 * - 第3章の `schedule_conflicts` を自動計算して格納
 * - スポット毎の `arrival_planned` / `departure_planned` を自動計算して格納
 * - 宿泊スポット（category === "lodging" かつ status !== "undecided" 優先）から `trip.lodging` を抽出
 *   （段階3で参加者・費用・持ち物・料理・写真も統合する）
 */
import { SCHEMA_VERSION, TIMEZONE, type VoyageExport } from "../export/schema";
import { toTokyoISO } from "../datetime";
import type { TripDoc } from "./types";
import { computeTripSchedule, spotsOfDay } from "../schedule/compute";

export function buildExportFromDoc(doc: TripDoc, now: Date = new Date()): VoyageExport {
  const { byDay, conflicts } = computeTripSchedule(doc.days, doc.spots);

  // 宿泊スポットから trip.lodging を抽出（decided 優先、なければ最初の lodging スポット）
  const lodgingSpots = doc.spots.filter((s) => s.category === "lodging");
  const primaryLodging =
    lodgingSpots.find((s) => s.status === "decided") ?? lodgingSpots[0] ?? null;

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: toTokyoISO(now),
    timezone: TIMEZONE,
    trip: {
      id: doc.trip.id,
      title: doc.trip.title,
      start_date: doc.trip.start_date,
      end_date: doc.trip.end_date,
      lodging: primaryLodging
        ? {
            name: primaryLodging.name,
            address: primaryLodging.address,
            lat: primaryLodging.lat,
            lng: primaryLodging.lng,
            check_in: primaryLodging.check_in,
            check_out: primaryLodging.check_out,
          }
        : null,
      participants: [],
      days: doc.days.map((d) => {
        const daySpots = spotsOfDay(doc.spots, d.day_index);
        const daySched = byDay.get(d.day_index);
        return {
          day_index: d.day_index,
          label: d.label,
          date: d.date,
          ...(d.day_index > 0
            ? {
                departure_point: d.departure_point,
                departure_time: d.departure_time,
              }
            : {}),
          spots: daySpots.map((s) => {
            const timing = daySched?.timings[s.id];
            return {
              id: s.id,
              name: s.name,
              category: s.category,
              status: s.status,
              is_main: s.is_main,
              address: s.address,
              lat: s.lat,
              lng: s.lng,
              place_url:
                s.place_url ??
                (s.lat !== null && s.lng !== null
                  ? `https://maps.google.com/?q=${s.lat},${s.lng}`
                  : null),
              arrival_planned: timing?.arrival ?? null,
              departure_planned: timing?.departure ?? null,
              stay_minutes: s.stay_minutes,
              reservation_time: s.reservation_time,
              is_fixed: s.is_fixed,
              memo: s.memo,
              transport_from_prev: s.transport_mode
                ? {
                    mode: s.transport_mode,
                    duration_minutes: s.transport_duration_minutes,
                    distance_m: s.transport_distance_m,
                    note: s.transport_note,
                  }
                : null,
              photos: [],
            };
          }),
          photos: [],
        };
      }),
      costs: [],
      belongings: [],
      dishes: [],
      schedule_conflicts: conflicts,
      notes: doc.trip.notes,
    },
  };
}

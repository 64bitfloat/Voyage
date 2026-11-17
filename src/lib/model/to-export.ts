/**
 * 内部状態（TripDoc）から Muse 連携用 JSON（VoyageExport）への変換。
 * - 第3章の `schedule_conflicts` を自動計算して格納
 * - スポット毎の `arrival_planned` / `departure_planned` を自動計算して格納
 * - 宿泊スポット（category === "lodging" かつ status === "decided" 優先）から `trip.lodging` を抽出
 * - 参加者・費用（個人別内訳含む）・持ち物・料理（材料含む）・写真（スポット別・日程別）を完全統合
 */
import { CURRENCY, SCHEMA_VERSION, TIMEZONE, type VoyageExport } from "../export/schema";
import { toTokyoISO } from "../datetime";
import type { TripDoc } from "./types";
import { computeTripSchedule, spotsOfDay } from "../schedule/compute";

export function buildExportFromDoc(doc: TripDoc, now: Date = new Date()): VoyageExport {
  const { byDay, conflicts } = computeTripSchedule(doc.days, doc.spots);

  // 宿泊スポットから trip.lodging を抽出（decided 優先、なければ最初の lodging スポット）
  const lodgingSpots = doc.spots.filter((s) => s.category === "lodging");
  const primaryLodging =
    lodgingSpots.find((s) => s.status === "decided") ?? lodgingSpots[0] ?? null;

  // 参加者 ID → 本名 のマップ（万が一 full_name が後から更新された場合も追従）
  const participantById = new Map(doc.participants.map((p) => [p.id, p.full_name]));
  const resolveName = (id: string | null, fallback: string | null): string | null => {
    if (id && participantById.has(id)) return participantById.get(id)!;
    return fallback;
  };

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
      participants: doc.participants.map((p) => ({
        full_name: p.full_name,
        nickname: p.nickname,
        role: p.role,
      })),
      days: doc.days.map((d) => {
        const daySpots = spotsOfDay(doc.spots, d.day_index);
        const daySched = byDay.get(d.day_index);
        const dayOnlyPhotos = doc.photos.filter(
          (ph) => ph.spot_id === null && ph.day_index === d.day_index,
        );
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
            const spotPhotos = doc.photos.filter((ph) => ph.spot_id === s.id);
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
              photos: spotPhotos.map((ph) => ({
                id: ph.id,
                url: ph.url,
                caption: ph.caption,
                photographer_nickname: ph.photographer_nickname,
                taken_at: ph.taken_at,
              })),
            };
          }),
          photos: dayOnlyPhotos.map((ph) => ({
            id: ph.id,
            url: ph.url,
            caption: ph.caption,
            photographer_nickname: ph.photographer_nickname,
            taken_at: ph.taken_at,
          })),
        };
      }),
      costs: doc.costs.map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category,
        total_paid_amount_jpy: c.total_paid_amount_jpy,
        currency: CURRENCY,
        payer_full_name: resolveName(c.payer_participant_id, c.payer_full_name),
        related_spot_id: c.related_spot_id,
        related_day_index: c.related_day_index,
        is_settled: c.is_settled,
        note: c.note,
        individual_breakdown: c.individual_breakdown.map((b) => ({
          consumer_full_name: resolveName(b.consumer_participant_id, b.consumer_full_name) ?? "",
          amount_jpy: b.amount_jpy,
          note: b.note,
        })),
      })),
      belongings: doc.belongings.map((b) => ({
        id: b.id,
        name: b.name,
        is_needed: b.is_needed,
        is_prepared: b.is_prepared,
        assignee_full_name: resolveName(b.assignee_participant_id, b.assignee_full_name),
        note: b.note,
      })),
      dishes: doc.dishes.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        related_day_index: d.related_day_index,
        ingredients: d.ingredients.map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          ingredient_name: ing.ingredient_name,
        })),
      })),
      schedule_conflicts: conflicts,
      notes: doc.trip.notes,
    },
  };
}

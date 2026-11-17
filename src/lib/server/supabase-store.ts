import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toTokyoISO } from "../datetime";
import type { DayRow, SpotRow, TripDoc, TripRow } from "../model/types";
import type { TripStore } from "./store";

/**
 * Supabase 実装。service role key を使うためサーバー専用。
 * RLS はポリシーなしで有効化しているため、anon key ではテーブルに触れない。
 */
export class SupabaseStore implements TripStore {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async getTripDoc(tripId: string): Promise<TripDoc | null> {
    const [trip, days, spots] = await Promise.all([
      this.db.from("trips").select("id,title,start_date,end_date,notes,passcode_hash").eq("id", tripId).maybeSingle(),
      this.db.from("days").select("*").eq("trip_id", tripId).order("day_index"),
      this.db.from("spots").select("*").eq("trip_id", tripId).order("day_index").order("sort_order"),
    ]);
    if (trip.error) throw trip.error;
    if (!trip.data) return null;
    if (days.error) throw days.error;
    if (spots.error) throw spots.error;

    const { passcode_hash, ...t } = trip.data;
    return {
      trip: { ...(t as Omit<TripRow, "has_passcode">), has_passcode: !!passcode_hash },
      days: (days.data ?? []).map(dayFromDb),
      spots: (spots.data ?? []).map(spotFromDb),
    };
  }

  async createTrip(trip: Omit<TripRow, "has_passcode">, days: DayRow[]) {
    const r1 = await this.db.from("trips").insert(trip);
    if (r1.error) throw r1.error;
    const r2 = await this.db.from("days").insert(days.map((d) => ({ ...d, trip_id: trip.id })));
    if (r2.error) throw r2.error;
  }

  async updateTrip(tripId: string, patch: Partial<Pick<TripRow, "title" | "notes">>) {
    const r = await this.db.from("trips").update(patch).eq("id", tripId);
    if (r.error) throw r.error;
  }

  async upsertDay(tripId: string, day: DayRow) {
    const r = await this.db.from("days").upsert({ ...day, trip_id: tripId }, { onConflict: "trip_id,day_index" });
    if (r.error) throw r.error;
  }

  async createSpot(tripId: string, spot: SpotRow) {
    const r = await this.db.from("spots").upsert({ ...spot, trip_id: tripId }, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw r.error;
  }

  async updateSpot(tripId: string, spotId: string, patch: Partial<SpotRow>) {
    const r = await this.db.from("spots").update(patch).eq("trip_id", tripId).eq("id", spotId).select("id");
    if (r.error) throw r.error;
    return (r.data?.length ?? 0) > 0;
  }

  async deleteSpot(tripId: string, spotId: string) {
    const r = await this.db.from("spots").delete().eq("trip_id", tripId).eq("id", spotId).select("id");
    if (r.error) throw r.error;
    return (r.data?.length ?? 0) > 0;
  }

  async reorderSpots(tripId: string, dayIndex: number, orderedIds: string[]) {
    // 件数は1日あたり高々数十件のため個別更新で十分
    const results = await Promise.all(
      orderedIds.map((id, i) =>
        this.db.from("spots").update({ sort_order: i }).eq("trip_id", tripId).eq("day_index", dayIndex).eq("id", id),
      ),
    );
    const err = results.find((r) => r.error)?.error;
    if (err) throw err;
  }
}

/* ---------------- DB → アプリ表現の正規化 ---------------- */

const tz = (v: unknown): string | null => (v ? toTokyoISO(new Date(String(v))) : null);
const hhmm = (v: unknown): string | null => (v ? String(v).slice(0, 5) : null);

function dayFromDb(r: Record<string, unknown>): DayRow {
  return {
    day_index: Number(r.day_index),
    label: String(r.label ?? ""),
    date: (r.date as string | null) ?? null,
    departure_point: (r.departure_point as string | null) ?? null,
    departure_lat: r.departure_lat == null ? null : Number(r.departure_lat),
    departure_lng: r.departure_lng == null ? null : Number(r.departure_lng),
    departure_time: hhmm(r.departure_time),
  };
}

function spotFromDb(r: Record<string, unknown>): SpotRow {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    day_index: Number(r.day_index),
    sort_order: Number(r.sort_order ?? 0),
    name: String(r.name ?? ""),
    category: r.category as SpotRow["category"],
    status: r.status as SpotRow["status"],
    is_main: Boolean(r.is_main),
    address: (r.address as string | null) ?? null,
    lat: num(r.lat),
    lng: num(r.lng),
    place_url: (r.place_url as string | null) ?? null,
    stay_minutes: Number(r.stay_minutes ?? 0),
    reservation_time: tz(r.reservation_time),
    is_fixed: Boolean(r.is_fixed),
    memo: String(r.memo ?? ""),
    transport_mode: (r.transport_mode as SpotRow["transport_mode"]) ?? null,
    transport_duration_minutes: num(r.transport_duration_minutes),
    transport_distance_m: num(r.transport_distance_m),
    transport_note: String(r.transport_note ?? ""),
    check_in: tz(r.check_in),
    check_out: tz(r.check_out),
  };
}

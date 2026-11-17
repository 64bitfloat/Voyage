import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toTokyoISO } from "../datetime";
import type {
  BelongingRow,
  CostRow,
  DayRow,
  DishRow,
  ParticipantRow,
  PhotoRow,
  SpotRow,
  TripDoc,
  TripRow,
} from "../model/types";
import { verifyPasscode } from "./passcode";
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
    const [trip, days, spots, participants, costs, belongings, dishes, photos] = await Promise.all([
      this.db.from("trips").select("id,title,start_date,end_date,notes,passcode_hash").eq("id", tripId).maybeSingle(),
      this.db.from("days").select("*").eq("trip_id", tripId).order("day_index"),
      this.db.from("spots").select("*").eq("trip_id", tripId).order("day_index").order("sort_order"),
      this.db.from("participants").select("*").eq("trip_id", tripId).order("sort_order"),
      this.db.from("costs").select("*, cost_breakdowns(*)").eq("trip_id", tripId).order("created_at"),
      this.db.from("belongings").select("*").eq("trip_id", tripId).order("sort_order"),
      this.db.from("dishes").select("*, dish_ingredients(*)").eq("trip_id", tripId).order("sort_order"),
      this.db.from("photos").select("*").eq("trip_id", tripId).order("created_at"),
    ]);
    if (trip.error) throw trip.error;
    if (!trip.data) return null;
    if (days.error) throw days.error;
    if (spots.error) throw spots.error;
    if (participants.error) throw participants.error;
    if (costs.error) throw costs.error;
    if (belongings.error) throw belongings.error;
    if (dishes.error) throw dishes.error;
    if (photos.error) throw photos.error;

    const pList: ParticipantRow[] = (participants.data ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      full_name: String(p.full_name ?? ""),
      nickname: String(p.nickname ?? ""),
      role: String(p.role ?? ""),
      sort_order: Number(p.sort_order ?? 0),
    }));
    const pNameMap = new Map(pList.map((p) => [p.id, p.full_name]));

    const { passcode_hash, ...t } = trip.data;
    return {
      trip: { ...(t as Omit<TripRow, "has_passcode">), has_passcode: !!passcode_hash },
      days: (days.data ?? []).map(dayFromDb),
      spots: (spots.data ?? []).map(spotFromDb),
      participants: pList,
      costs: (costs.data ?? []).map((c: Record<string, unknown>) => costFromDb(c, pNameMap)),
      belongings: (belongings.data ?? []).map((b: Record<string, unknown>) => belongingFromDb(b, pNameMap)),
      dishes: (dishes.data ?? []).map((d: Record<string, unknown>) => dishFromDb(d)),
      photos: (photos.data ?? []).map((ph: Record<string, unknown>) => photoFromDb(ph)),
    };
  }

  async createTrip(
    trip: Omit<TripRow, "has_passcode">,
    days: DayRow[],
    passcodeHash?: string | null,
  ) {
    const r1 = await this.db.from("trips").insert({ ...trip, passcode_hash: passcodeHash ?? null });
    if (r1.error) throw r1.error;
    const r2 = await this.db.from("days").insert(days.map((d) => ({ ...d, trip_id: trip.id })));
    if (r2.error) throw r2.error;
  }

  async verifyTripPasscode(tripId: string, passcode: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("trips")
      .select("passcode_hash")
      .eq("id", tripId)
      .maybeSingle();
    if (error || !data) return false;
    return verifyPasscode(passcode, data.passcode_hash as string | null);
  }

  async updateTrip(
    tripId: string,
    patch: Partial<Pick<TripRow, "title" | "start_date" | "end_date" | "notes">>,
  ) {
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
    const results = await Promise.all(
      orderedIds.map((id, i) =>
        this.db.from("spots").update({ sort_order: i }).eq("trip_id", tripId).eq("day_index", dayIndex).eq("id", id),
      ),
    );
    const err = results.find((r) => r.error)?.error;
    if (err) throw err;
  }

  async upsertParticipant(tripId: string, p: ParticipantRow) {
    const r = await this.db.from("participants").upsert(
      {
        id: p.id,
        trip_id: tripId,
        full_name: p.full_name,
        nickname: p.nickname,
        role: p.role,
        sort_order: p.sort_order,
      },
      { onConflict: "id" },
    );
    if (r.error) throw r.error;
  }

  async deleteParticipant(tripId: string, participantId: string) {
    const r = await this.db.from("participants").delete().eq("trip_id", tripId).eq("id", participantId);
    if (r.error) throw r.error;
  }

  async upsertCost(tripId: string, cost: CostRow) {
    const r1 = await this.db.from("costs").upsert(
      {
        id: cost.id,
        trip_id: tripId,
        title: cost.title,
        category: cost.category,
        total_paid_amount_jpy: cost.total_paid_amount_jpy,
        payer_participant_id: cost.payer_participant_id,
        related_spot_id: cost.related_spot_id,
        related_day_index: cost.related_day_index,
        is_settled: cost.is_settled,
        note: cost.note,
      },
      { onConflict: "id" },
    );
    if (r1.error) throw r1.error;

    await this.db.from("cost_breakdowns").delete().eq("cost_id", cost.id);
    if (cost.individual_breakdown.length > 0) {
      const r2 = await this.db.from("cost_breakdowns").insert(
        cost.individual_breakdown.map((b, idx) => ({
          cost_id: cost.id,
          consumer_participant_id: b.consumer_participant_id,
          amount_jpy: b.amount_jpy,
          note: b.note,
          sort_order: idx,
        })),
      );
      if (r2.error) throw r2.error;
    }
  }

  async deleteCost(tripId: string, costId: string) {
    const r = await this.db.from("costs").delete().eq("trip_id", tripId).eq("id", costId);
    if (r.error) throw r.error;
  }

  async upsertBelonging(tripId: string, b: BelongingRow) {
    const r = await this.db.from("belongings").upsert(
      {
        id: b.id,
        trip_id: tripId,
        name: b.name,
        is_needed: b.is_needed,
        is_prepared: b.is_prepared,
        assignee_participant_id: b.assignee_participant_id,
        note: b.note,
        sort_order: b.sort_order,
      },
      { onConflict: "id" },
    );
    if (r.error) throw r.error;
  }

  async deleteBelonging(tripId: string, belongingId: string) {
    const r = await this.db.from("belongings").delete().eq("trip_id", tripId).eq("id", belongingId);
    if (r.error) throw r.error;
  }

  async upsertDish(tripId: string, dish: DishRow) {
    const r1 = await this.db.from("dishes").upsert(
      {
        id: dish.id,
        trip_id: tripId,
        name: dish.name,
        status: dish.status,
        related_day_index: dish.related_day_index,
        sort_order: dish.sort_order,
      },
      { onConflict: "id" },
    );
    if (r1.error) throw r1.error;

    await this.db.from("dish_ingredients").delete().eq("dish_id", dish.id);
    if (dish.ingredients.length > 0) {
      const r2 = await this.db.from("dish_ingredients").insert(
        dish.ingredients.map((ing, idx) => ({
          dish_id: dish.id,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          ingredient_name: ing.ingredient_name,
          sort_order: idx,
        })),
      );
      if (r2.error) throw r2.error;
    }
  }

  async deleteDish(tripId: string, dishId: string) {
    const r = await this.db.from("dishes").delete().eq("trip_id", tripId).eq("id", dishId);
    if (r.error) throw r.error;
  }

  async createPhoto(tripId: string, photo: PhotoRow) {
    let finalUrl = photo.url;
    // Supabase Storage バケット "photos" が利用可能な場合は data URL をアップロードし公開URLへ変換
    if (photo.url.startsWith("data:image/")) {
      try {
        const commaIdx = photo.url.indexOf(",");
        const meta = photo.url.slice(0, commaIdx);
        const base64 = photo.url.slice(commaIdx + 1);
        const mime = meta.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
        const ext = mime === "image/png" ? "png" : "jpg";
        const path = `${tripId}/${photo.id}.${ext}`;
        const bytes = Buffer.from(base64, "base64");
        const up = await this.db.storage
          .from("photos")
          .upload(path, bytes, { contentType: mime, upsert: true });
        if (!up.error) {
          const pub = this.db.storage.from("photos").getPublicUrl(path);
          if (pub.data?.publicUrl) finalUrl = pub.data.publicUrl;
        }
      } catch {
        // Storage バケット未作成時は data URL のまま storage_path カラムに保持
      }
    }
    const r = await this.db.from("photos").upsert(
      {
        id: photo.id,
        trip_id: tripId,
        spot_id: photo.spot_id,
        day_index: photo.day_index,
        storage_path: finalUrl,
        caption: photo.caption,
        photographer_nickname: photo.photographer_nickname,
        taken_at: photo.taken_at,
      },
      { onConflict: "id" },
    );
    if (r.error) throw r.error;
  }

  async deletePhoto(tripId: string, photoId: string) {
    const r = await this.db.from("photos").delete().eq("trip_id", tripId).eq("id", photoId);
    if (r.error) throw r.error;
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

function costFromDb(r: Record<string, unknown>, pNameMap: Map<string, string>): CostRow {
  const payerId = (r.payer_participant_id as string | null) ?? null;
  const breakdowns = Array.isArray(r.cost_breakdowns)
    ? (r.cost_breakdowns as Record<string, unknown>[])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((b) => {
          const cid = (b.consumer_participant_id as string | null) ?? null;
          return {
            consumer_participant_id: cid,
            consumer_full_name: (cid ? pNameMap.get(cid) : null) ?? "",
            amount_jpy: Number(b.amount_jpy ?? 0),
            note: String(b.note ?? ""),
          };
        })
    : [];
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    category: r.category as CostRow["category"],
    total_paid_amount_jpy: Number(r.total_paid_amount_jpy ?? 0),
    payer_participant_id: payerId,
    payer_full_name: payerId ? (pNameMap.get(payerId) ?? null) : null,
    related_spot_id: (r.related_spot_id as string | null) ?? null,
    related_day_index: r.related_day_index == null ? null : Number(r.related_day_index),
    is_settled: Boolean(r.is_settled),
    note: String(r.note ?? ""),
    individual_breakdown: breakdowns,
  };
}

function belongingFromDb(r: Record<string, unknown>, pNameMap: Map<string, string>): BelongingRow {
  const aid = (r.assignee_participant_id as string | null) ?? null;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    is_needed: Boolean(r.is_needed),
    is_prepared: Boolean(r.is_prepared),
    assignee_participant_id: aid,
    assignee_full_name: aid ? (pNameMap.get(aid) ?? null) : null,
    note: String(r.note ?? ""),
    sort_order: Number(r.sort_order ?? 0),
  };
}

function dishFromDb(r: Record<string, unknown>): DishRow {
  const ings = Array.isArray(r.dish_ingredients)
    ? (r.dish_ingredients as Record<string, unknown>[])
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((ing) => ({
          name: String(ing.name ?? ""),
          quantity: ing.quantity == null ? null : Number(ing.quantity),
          unit: String(ing.unit ?? ""),
          ingredient_name: String(ing.ingredient_name ?? ""),
        }))
    : [];
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    status: r.status as DishRow["status"],
    related_day_index: r.related_day_index == null ? null : Number(r.related_day_index),
    ingredients: ings,
    sort_order: Number(r.sort_order ?? 0),
  };
}

function photoFromDb(r: Record<string, unknown>): PhotoRow {
  return {
    id: String(r.id),
    spot_id: (r.spot_id as string | null) ?? null,
    day_index: r.day_index == null ? null : Number(r.day_index),
    url: String(r.storage_path ?? ""),
    caption: String(r.caption ?? ""),
    photographer_nickname: String(r.photographer_nickname ?? ""),
    taken_at: tz(r.taken_at),
  };
}

import type { DayRow, SpotRow, TripDoc, TripRow } from "../model/types";

/**
 * 永続化層の抽象。API Route はこのインターフェースだけを使う。
 * - SupabaseStore: 本番（環境変数が揃っている場合）
 * - MemoryStore  : Supabase未設定時のローカル開発用（サーバー再起動で消える）
 */
export interface TripStore {
  readonly kind: "supabase" | "memory";
  getTripDoc(tripId: string): Promise<TripDoc | null>;
  createTrip(trip: Omit<TripRow, "has_passcode">, days: DayRow[]): Promise<void>;
  updateTrip(tripId: string, patch: Partial<Pick<TripRow, "title" | "notes">>): Promise<void>;
  upsertDay(tripId: string, day: DayRow): Promise<void>;
  createSpot(tripId: string, spot: SpotRow): Promise<void>;
  updateSpot(tripId: string, spotId: string, patch: Partial<SpotRow>): Promise<boolean>;
  deleteSpot(tripId: string, spotId: string): Promise<boolean>;
  reorderSpots(tripId: string, dayIndex: number, orderedIds: string[]): Promise<void>;
}

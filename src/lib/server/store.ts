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

/**
 * 永続化層の抽象。API Route はこのインターフェースだけを使う。
 * - SupabaseStore: 本番（環境変数が揃っている場合）
 * - MemoryStore  : Supabase未設定時のローカル開発用（サーバー再起動で消える）
 */
export interface TripStore {
  readonly kind: "supabase" | "memory";
  getTripDoc(tripId: string): Promise<TripDoc | null>;
  createTrip(
    trip: Omit<TripRow, "has_passcode">,
    days: DayRow[],
    passcodeHash?: string | null,
  ): Promise<void>;
  verifyTripPasscode(tripId: string, passcode: string): Promise<boolean>;
  updateTrip(
    tripId: string,
    patch: Partial<Pick<TripRow, "title" | "start_date" | "end_date" | "notes">>,
  ): Promise<void>;
  upsertDay(tripId: string, day: DayRow): Promise<void>;
  createSpot(tripId: string, spot: SpotRow): Promise<void>;
  updateSpot(tripId: string, spotId: string, patch: Partial<SpotRow>): Promise<boolean>;
  deleteSpot(tripId: string, spotId: string): Promise<boolean>;
  reorderSpots(tripId: string, dayIndex: number, orderedIds: string[]): Promise<void>;

  // 段階3 エンティティ
  upsertParticipant(tripId: string, participant: ParticipantRow): Promise<void>;
  deleteParticipant(tripId: string, participantId: string): Promise<void>;

  upsertCost(tripId: string, cost: CostRow): Promise<void>;
  deleteCost(tripId: string, costId: string): Promise<void>;

  upsertBelonging(tripId: string, belonging: BelongingRow): Promise<void>;
  deleteBelonging(tripId: string, belongingId: string): Promise<void>;

  upsertDish(tripId: string, dish: DishRow): Promise<void>;
  deleteDish(tripId: string, dishId: string): Promise<void>;

  createPhoto(tripId: string, photo: PhotoRow): Promise<void>;
  deletePhoto(tripId: string, photoId: string): Promise<void>;
}

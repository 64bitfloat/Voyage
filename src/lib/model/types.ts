/**
 * アプリ内部のデータモデル（DB行に対応）とAPI入力のZodスキーマ。
 * 列挙値はエクスポート契約（export/schema.ts）と共有し、二重定義しない。
 *
 * 日時: アプリ内部でも ISO 8601 +09:00 文字列で保持する（DBは timestamptz）。
 */
import { z } from "zod";
import {
  CostCategory,
  DateSchema,
  DateTimeSchema,
  DishStatus,
  IdSchema,
  LatSchema,
  LngSchema,
  SpotCategory,
  SpotStatus,
  TimeSchema,
  TransportMode,
  YenSchema,
} from "../export/schema";

export const PasscodeInput = z
  .string()
  .regex(/^\d{4}$/, "4桁の数字で入力してください");

export const TripRowSchema = z.object({
  id: IdSchema,
  title: z.string().max(200),
  start_date: DateSchema.nullable(),
  end_date: DateSchema.nullable(),
  notes: z.string().max(10000),
  has_passcode: z.boolean(),
});
export type TripRow = z.infer<typeof TripRowSchema>;

export const DayRowSchema = z.object({
  day_index: z.number().int().nonnegative(),
  label: z.string().max(50),
  date: DateSchema.nullable(),
  departure_point: z.string().max(200).nullable(),
  departure_lat: LatSchema.nullable(),
  departure_lng: LngSchema.nullable(),
  departure_time: TimeSchema.nullable(),
});
export type DayRow = z.infer<typeof DayRowSchema>;

export const SpotRowSchema = z.object({
  id: IdSchema,
  day_index: z.number().int().nonnegative(),
  sort_order: z.number().int(),
  name: z.string().max(200),
  category: SpotCategory,
  status: SpotStatus,
  is_main: z.boolean(),
  address: z.string().max(500).nullable(),
  lat: LatSchema.nullable(),
  lng: LngSchema.nullable(),
  place_url: z
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "http/https URLのみ指定できます")
    .nullable(),
  stay_minutes: z.number().int().min(0).max(24 * 60 * 7),
  reservation_time: DateTimeSchema.nullable(),
  is_fixed: z.boolean(),
  memo: z.string().max(5000),
  transport_mode: TransportMode.nullable(),
  transport_duration_minutes: z.number().int().min(0).max(24 * 60 * 3).nullable(),
  transport_distance_m: z.number().int().min(0).nullable(),
  transport_note: z.string().max(500),
  check_in: DateTimeSchema.nullable(),
  check_out: DateTimeSchema.nullable(),
});
export type SpotRow = z.infer<typeof SpotRowSchema>;

/* ------------------------------------------------------------------ */
/* 段階3 エンティティ（参加者・費用・持ち物・料理・写真）              */
/* ------------------------------------------------------------------ */

export const ParticipantRowSchema = z.object({
  id: IdSchema,
  full_name: z.string().max(100),
  nickname: z.string().max(50),
  role: z.string().max(100),
  sort_order: z.number().int().default(0),
});
export type ParticipantRow = z.infer<typeof ParticipantRowSchema>;

export const CostBreakdownRowSchema = z.object({
  consumer_participant_id: IdSchema.nullable(),
  consumer_full_name: z.string().max(100),
  amount_jpy: YenSchema,
  note: z.string().max(200),
});
export type CostBreakdownRow = z.infer<typeof CostBreakdownRowSchema>;

/** 費用の項目（レシート読み取り or 手入力）。assignment は "split" か参加者の full_name */
export const CostLineItemRowSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  amount_jpy: YenSchema.min(-10_000_000).max(100_000_000),
  assignment: z.string().min(1).max(500),
  assignees: z.array(z.string().max(100)).max(50).optional(),
});
export type CostLineItemRow = z.infer<typeof CostLineItemRowSchema>;

/** 費用に添付したレシート画像（Supabase Storage の公開URL、または未設定時は data URL） */
export const CostReceiptRowSchema = z.object({
  id: IdSchema,
  url: z
    .string()
    .max(8_000_000)
    .refine(
      (u) => /^https:\/\//i.test(u) || /^data:image\/(jpeg|png|webp);base64,/i.test(u),
      "レシート画像は https URL または画像の data URL のみ指定できます",
    ),
  created_at: DateTimeSchema.nullable(),
});
export type CostReceiptRow = z.infer<typeof CostReceiptRowSchema>;

export const CostRowSchema = z.object({
  id: IdSchema,
  title: z.string().max(200),
  category: CostCategory,
  total_paid_amount_jpy: YenSchema,
  payer_participant_id: IdSchema.nullable(),
  payer_full_name: z.string().max(100).nullable(),
  related_spot_id: IdSchema.nullable(),
  related_day_index: z.number().int().nonnegative().nullable(),
  is_settled: z.boolean(),
  note: z.string().max(1000),
  individual_breakdown: z.array(CostBreakdownRowSchema).max(200),
  /** 項目ごとに分ける場合の項目リスト（無い/空なら従来どおり individual_breakdown を直接編集） */
  line_items: z.array(CostLineItemRowSchema).max(300).optional(),
  /** 添付レシート画像 */
  receipts: z.array(CostReceiptRowSchema).max(10).optional(),
});
export type CostRow = z.infer<typeof CostRowSchema>;

export const BelongingRowSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  is_needed: z.boolean(),
  is_prepared: z.boolean(),
  assignee_participant_id: IdSchema.nullable(),
  assignee_full_name: z.string().max(100).nullable(),
  note: z.string().max(500),
  sort_order: z.number().int().default(0),
});
export type BelongingRow = z.infer<typeof BelongingRowSchema>;

export const DishIngredientRowSchema = z.object({
  name: z.string().max(100),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().max(50),
  ingredient_name: z.string().max(100),
});
export type DishIngredientRow = z.infer<typeof DishIngredientRowSchema>;

export const DishRowSchema = z.object({
  id: IdSchema,
  name: z.string().max(200),
  status: DishStatus,
  related_day_index: z.number().int().nonnegative().nullable(),
  ingredients: z.array(DishIngredientRowSchema),
  sort_order: z.number().int().default(0),
});
export type DishRow = z.infer<typeof DishRowSchema>;

export const PhotoRowSchema = z
  .object({
    id: IdSchema,
    spot_id: IdSchema.nullable(),
    day_index: z.number().int().nonnegative().nullable(),
    /** data URL または https URL（エクスポート時は z.url() でどちらでも検証を通る） */
    url: z.url(),
    caption: z.string().max(500),
    photographer_nickname: z.string().max(50),
    taken_at: DateTimeSchema.nullable(),
  })
  .refine((p) => p.spot_id !== null || p.day_index !== null, {
    message: "写真は必ずスポットまたは日程のいずれかに紐付けてください",
  });
export type PhotoRow = z.infer<typeof PhotoRowSchema>;

/** 1旅行分のまとまり（クライアントが保持する状態） */
export interface TripDoc {
  trip: TripRow;
  days: DayRow[];
  spots: SpotRow[];
  participants: ParticipantRow[];
  costs: CostRow[];
  belongings: BelongingRow[];
  dishes: DishRow[];
  photos: PhotoRow[];
}

/* ------------------------------------------------------------------ */
/* API 入力（保存時検証）                                              */
/* ------------------------------------------------------------------ */

export const CreateTripInput = z
  .object({
    title: z.string().trim().min(1, "旅行名を入力してください").max(200),
    start_date: DateSchema.nullable(),
    end_date: DateSchema.nullable(),
    passcode: PasscodeInput,
  })
  .refine((v) => !v.start_date || !v.end_date || v.start_date <= v.end_date, {
    message: "終了日は開始日以降にしてください",
    path: ["end_date"],
  })
  .refine(
    (v) => !v.start_date || !v.end_date || daysBetween(v.start_date, v.end_date) <= 30,
    { message: "日程は31日以内にしてください", path: ["end_date"] },
  );
export type CreateTripInput = z.infer<typeof CreateTripInput>;

export const UpdateTripInput = TripRowSchema.pick({
  title: true,
  start_date: true,
  end_date: true,
  notes: true,
}).partial();

export const UpsertDayInput = DayRowSchema.omit({ day_index: true }).partial();

export const CreateSpotInput = SpotRowSchema;
export const UpdateSpotInput = SpotRowSchema.omit({ id: true }).partial();

export const ReorderSpotsInput = z.object({
  day_index: z.number().int().nonnegative(),
  ordered_ids: z.array(IdSchema).max(500),
});

export const VerifyPasscodeInput = z.object({
  passcode: z.string().regex(/^\d{4}$/, "4桁の数字を入力してください"),
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 新規旅行の初期日程（Day 1..N のみ。「出発前」は作らない） */
export function initialDays(start: string | null, end: string | null): DayRow[] {
  const empty = { departure_point: null, departure_lat: null, departure_lng: null, departure_time: null };
  const days: DayRow[] = [];
  const n = start && end && start <= end ? daysBetween(start, end) + 1 : 1;
  for (let i = 1; i <= n; i++) {
    days.push({
      day_index: i,
      label: `Day ${i}`,
      date: start ? addDays(start, i - 1) : null,
      ...empty,
      departure_time: "08:00",
    });
  }
  return days;
}

export function newSpot(partial: Partial<SpotRow> & Pick<SpotRow, "id" | "day_index">): SpotRow {
  return {
    sort_order: 0,
    name: "",
    category: "sightseeing",
    status: "undecided",
    is_main: false,
    address: null,
    lat: null,
    lng: null,
    place_url: null,
    stay_minutes: 60,
    reservation_time: null,
    is_fixed: false,
    memo: "",
    transport_mode: "car",
    transport_duration_minutes: null,
    transport_distance_m: null,
    transport_note: "",
    check_in: null,
    check_out: null,
    ...partial,
  };
}

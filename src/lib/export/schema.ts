/**
 * Voyage → Muse 連携用データ契約（schema_version 1.0）
 *
 * - このファイルが「唯一の正」。TypeScript型はすべてZodスキーマから z.infer で導出する。
 * - Notion のプロパティ名・選択肢名はここに一切書かない（Muse側で毎回対応付ける）。
 * - 構造的な誤り（型違い・形式違い）はスキーマで弾く。
 *   「未入力」「整合性」の問題はエクスポートを止めず、validate.ts の警告として扱う。
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0" as const;
export const TIMEZONE = "Asia/Tokyo" as const;
export const CURRENCY = "JPY" as const;

/* ------------------------------------------------------------------ */
/* プリミティブ（日付・時刻・金額・座標・ID）                          */
/* ------------------------------------------------------------------ */

/** YYYY-MM-DD（実在する日付のみ） */
export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "日付は YYYY-MM-DD 形式で指定してください", abort: true })
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "存在しない日付です");

/** HH:MM（24時間制） */
export const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM（24時間制）で指定してください");

/** ISO 8601 日時（秒まで・UTCオフセット必須。例: 2026-12-12T10:00:00+09:00） */
export const DateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d[+-]\d{2}:\d{2}$/,
    { message: "日時は ISO 8601（例: 2026-12-12T10:00:00+09:00）で指定してください", abort: true },
  )
  .refine((s) => !Number.isNaN(Date.parse(s)), "解釈できない日時です");

/** 安定ID（UUID）。エクスポートのたびに再生成してはいけない */
export const IdSchema = z.uuid({ message: "id は UUID である必要があります" });

/** 日本円の整数金額（カンマ・円記号なし）。0以下は警告側で扱う */
export const YenSchema = z
  .number({ message: "金額は数値（整数の日本円）で指定してください" })
  .int("金額は整数（円）で指定してください");

export const LatSchema = z.number().min(-90).max(90);
export const LngSchema = z.number().min(-180).max(180);

/* ------------------------------------------------------------------ */
/* 列挙値（英語固定。日本語の自由記述にしない）                        */
/* ------------------------------------------------------------------ */

export const SpotCategory = z.enum(["meal", "sightseeing", "lodging", "transport", "shopping", "other"]);
export const SpotStatus = z.enum(["decided", "candidate", "undecided"]);
export const TransportMode = z.enum(["car", "walk", "train", "manual"]);
export const CostCategory = z.enum(["lodging", "transport", "food", "ticket", "shopping", "other"]);
export const DishStatus = z.enum(["decided", "candidate"]);

/* ------------------------------------------------------------------ */
/* エンティティ                                                        */
/* ------------------------------------------------------------------ */

export const PhotoSchema = z.object({
  id: IdSchema,
  url: z.url(),
  caption: z.string(),
  photographer_nickname: z.string(),
  taken_at: DateTimeSchema.nullable(),
});

export const TransportSchema = z.object({
  mode: TransportMode,
  duration_minutes: z.number().int().nonnegative().nullable(),
  distance_m: z.number().int().nonnegative().nullable(),
  note: z.string(),
});

export const SpotSchema = z.object({
  id: IdSchema,
  name: z.string(),
  category: SpotCategory,
  status: SpotStatus,
  is_main: z.boolean(),
  address: z.string().nullable(),
  lat: LatSchema.nullable(),
  lng: LngSchema.nullable(),
  place_url: z.url().nullable(),
  arrival_planned: DateTimeSchema.nullable(),
  departure_planned: DateTimeSchema.nullable(),
  stay_minutes: z.number().int().nonnegative(),
  reservation_time: DateTimeSchema.nullable(),
  is_fixed: z.boolean(),
  memo: z.string(),
  /** その日の最初のスポットは出発地点からの移動。手段未設定なら null */
  transport_from_prev: TransportSchema.nullable(),
  photos: z.array(PhotoSchema),
});

export const DaySchema = z.object({
  day_index: z.number().int().nonnegative(),
  label: z.string(),
  /** 「出発前」(day_index 0) は null */
  date: DateSchema.nullable(),
  departure_point: z.string().nullable().optional(),
  departure_time: TimeSchema.nullable().optional(),
  spots: z.array(SpotSchema),
  /** スポットに属さない、日程全体に紐付く写真（第4章: day_index 紐付け） */
  photos: z.array(PhotoSchema).default([]),
});

export const LodgingSchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  lat: LatSchema.nullable(),
  lng: LngSchema.nullable(),
  check_in: DateTimeSchema.nullable(),
  check_out: DateTimeSchema.nullable(),
});

export const ParticipantSchema = z.object({
  /** 本名・フルネーム（Notion参加者DBの氏名と一致させる） */
  full_name: z.string(),
  nickname: z.string(),
  role: z.string(),
});

export const BreakdownItemSchema = z.object({
  consumer_full_name: z.string(),
  amount_jpy: YenSchema,
  note: z.string(),
});

export const CostSchema = z.object({
  id: IdSchema,
  title: z.string(),
  category: CostCategory,
  /** 実際に支払った総額（共通部分だけの金額にしない） */
  total_paid_amount_jpy: YenSchema,
  currency: z.literal(CURRENCY),
  payer_full_name: z.string().nullable(),
  related_spot_id: IdSchema.nullable(),
  related_day_index: z.number().int().nonnegative().nullable(),
  is_settled: z.boolean(),
  note: z.string(),
  /** 個人別の内訳（支払者本人の分も含める）。空なら全額が割勘対象 */
  individual_breakdown: z.array(BreakdownItemSchema),
});

export const BelongingSchema = z.object({
  id: IdSchema,
  name: z.string(),
  is_needed: z.boolean(),
  is_prepared: z.boolean(),
  assignee_full_name: z.string().nullable(),
  note: z.string(),
});

export const IngredientSchema = z.object({
  name: z.string(),
  quantity: z.number().nonnegative().nullable(),
  unit: z.string(),
  ingredient_name: z.string(),
});

export const DishSchema = z.object({
  id: IdSchema,
  name: z.string(),
  status: DishStatus,
  related_day_index: z.number().int().nonnegative().nullable(),
  ingredients: z.array(IngredientSchema),
});

export const ScheduleConflictSchema = z.object({
  spot_id: IdSchema,
  spot_name: z.string(),
  reservation_time: DateTimeSchema,
  arrival_planned: DateTimeSchema,
  overrun_minutes: z.number().int().positive(),
});

export const TripSchema = z.object({
  id: IdSchema,
  title: z.string(),
  start_date: DateSchema.nullable(),
  end_date: DateSchema.nullable(),
  lodging: LodgingSchema.nullable(),
  participants: z.array(ParticipantSchema),
  days: z.array(DaySchema),
  costs: z.array(CostSchema),
  belongings: z.array(BelongingSchema),
  dishes: z.array(DishSchema),
  schedule_conflicts: z.array(ScheduleConflictSchema),
  notes: z.string(),
});

export const VoyageExportSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  exported_at: DateTimeSchema,
  timezone: z.literal(TIMEZONE),
  trip: TripSchema,
});

/* ------------------------------------------------------------------ */
/* 型（Zodから導出）                                                   */
/* ------------------------------------------------------------------ */

export type VoyageExport = z.infer<typeof VoyageExportSchema>;
/** パース前（default適用前）の入力型 */
export type VoyageExportInput = z.input<typeof VoyageExportSchema>;
export type Trip = z.infer<typeof TripSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Spot = z.infer<typeof SpotSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Transport = z.infer<typeof TransportSchema>;
export type Lodging = z.infer<typeof LodgingSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type Cost = z.infer<typeof CostSchema>;
export type BreakdownItem = z.infer<typeof BreakdownItemSchema>;
export type Belonging = z.infer<typeof BelongingSchema>;
export type Dish = z.infer<typeof DishSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type ScheduleConflict = z.infer<typeof ScheduleConflictSchema>;

export type SpotCategoryValue = z.infer<typeof SpotCategory>;
export type SpotStatusValue = z.infer<typeof SpotStatus>;
export type TransportModeValue = z.infer<typeof TransportMode>;
export type CostCategoryValue = z.infer<typeof CostCategory>;
export type DishStatusValue = z.infer<typeof DishStatus>;

/**
 * アプリ内部のデータモデル（DB行に対応）とAPI入力のZodスキーマ。
 * 列挙値はエクスポート契約（export/schema.ts）と共有し、二重定義しない。
 *
 * 日時: アプリ内部でも ISO 8601 +09:00 文字列で保持する（DBは timestamptz）。
 */
import { z } from "zod";
import {
  DateSchema,
  DateTimeSchema,
  IdSchema,
  LatSchema,
  LngSchema,
  SpotCategory,
  SpotStatus,
  TimeSchema,
  TransportMode,
} from "../export/schema";

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
  place_url: z.url().nullable(),
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

/** 1旅行分のまとまり（クライアントが保持する状態） */
export interface TripDoc {
  trip: TripRow;
  days: DayRow[];
  spots: SpotRow[];
}

/* ------------------------------------------------------------------ */
/* API 入力（保存時検証）                                              */
/* ------------------------------------------------------------------ */

export const CreateTripInput = z
  .object({
    title: z.string().trim().min(1, "旅行名を入力してください").max(200),
    start_date: DateSchema.nullable(),
    end_date: DateSchema.nullable(),
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

export const UpdateTripInput = TripRowSchema.pick({ title: true, notes: true }).partial();

export const UpsertDayInput = DayRowSchema.omit({ day_index: true }).partial();

export const CreateSpotInput = SpotRowSchema;
export const UpdateSpotInput = SpotRowSchema.omit({ id: true, day_index: true }).partial();

export const ReorderSpotsInput = z.object({
  day_index: z.number().int().nonnegative(),
  ordered_ids: z.array(IdSchema).max(500),
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

/** 新規旅行の初期日程（出発前 + Day1..N） */
export function initialDays(start: string | null, end: string | null): DayRow[] {
  const empty = { departure_point: null, departure_lat: null, departure_lng: null, departure_time: null };
  const days: DayRow[] = [{ day_index: 0, label: "出発前", date: null, ...empty }];
  const n = start && end ? daysBetween(start, end) + 1 : 1;
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

/**
 * サンプルデータ（第6.2章の例＋食事の混合支払い例）
 * IDは固定UUID（再エクスポートでも同一IDになることを模している）。
 */
import type { VoyageExportInput } from "./schema";

export const SAMPLE_IDS = {
  trip: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e01",
  spotLake: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e02",
  spotLunch: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e03",
  photo1: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e04",
  costMeal: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e05",
  costCamp: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e06",
  belongingWood: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e07",
  dishNabe: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e08",
  photoDay0: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e09",
} as const;

/** 全項目が正しく入力された正常系サンプル */
export const SAMPLE_EXPORT: VoyageExportInput = {
  schema_version: "1.0",
  exported_at: "2026-11-17T22:00:00+09:00",
  timezone: "Asia/Tokyo",
  trip: {
    id: SAMPLE_IDS.trip,
    title: "精進レークサイドキャンプ",
    start_date: "2026-12-12",
    end_date: "2026-12-13",
    lodging: {
      name: "Shoji Lake Side Camp",
      address: "山梨県南都留郡富士河口湖町精進",
      lat: 35.49,
      lng: 138.6,
      check_in: "2026-12-12T15:00:00+09:00",
      check_out: "2026-12-13T10:00:00+09:00",
    },
    participants: [
      { full_name: "松林凜", nickname: "りん", role: "" },
      { full_name: "横関海翔", nickname: "かいと", role: "" },
    ],
    days: [
      {
        day_index: 0,
        label: "出発前",
        date: null,
        spots: [],
        photos: [
          {
            id: SAMPLE_IDS.photoDay0,
            url: "https://example.supabase.co/storage/v1/object/public/photos/day0.jpg",
            caption: "買い出し完了",
            photographer_nickname: "かいと",
            taken_at: "2026-12-11T19:30:00+09:00",
          },
        ],
      },
      {
        day_index: 1,
        label: "Day 1",
        date: "2026-12-12",
        departure_point: "自宅",
        departure_time: "08:00",
        spots: [
          {
            id: SAMPLE_IDS.spotLake,
            name: "精進湖畔散策",
            category: "sightseeing",
            status: "decided",
            is_main: true,
            address: "山梨県南都留郡富士河口湖町精進",
            lat: 35.49,
            lng: 138.6,
            place_url: "https://maps.google.com/?q=35.49,138.6",
            arrival_planned: "2026-12-12T10:00:00+09:00",
            departure_planned: "2026-12-12T11:30:00+09:00",
            stay_minutes: 90,
            reservation_time: null,
            is_fixed: false,
            memo: "",
            transport_from_prev: { mode: "car", duration_minutes: 120, distance_m: 120000, note: "" },
            photos: [
              {
                id: SAMPLE_IDS.photo1,
                url: "https://example.supabase.co/storage/v1/object/public/photos/lake.jpg",
                caption: "",
                photographer_nickname: "りん",
                taken_at: "2026-12-12T10:05:00+09:00",
              },
            ],
          },
          {
            id: SAMPLE_IDS.spotLunch,
            name: "湖畔レストラン（コース予約）",
            category: "meal",
            status: "decided",
            is_main: false,
            address: "山梨県南都留郡富士河口湖町",
            lat: 35.5,
            lng: 138.65,
            place_url: null,
            arrival_planned: "2026-12-12T11:50:00+09:00",
            departure_planned: "2026-12-12T13:20:00+09:00",
            stay_minutes: 90,
            reservation_time: "2026-12-12T12:00:00+09:00",
            is_fixed: true,
            memo: "",
            transport_from_prev: { mode: "car", duration_minutes: 20, distance_m: 9000, note: "" },
            photos: [],
          },
        ],
      },
    ],
    costs: [
      {
        // 混合支払い: コース各5,000円 ＋ ドリンクA 1,000円・B 500円を、Aがまとめて11,500円支払い
        id: SAMPLE_IDS.costMeal,
        title: "食事 コース＋ドリンク",
        category: "food",
        total_paid_amount_jpy: 11500,
        currency: "JPY",
        payer_full_name: "松林凜",
        related_spot_id: SAMPLE_IDS.spotLunch,
        related_day_index: 1,
        is_settled: false,
        note: "コース各5000円＋ドリンク",
        individual_breakdown: [
          { consumer_full_name: "松林凜", amount_jpy: 1000, note: "ドリンクA" },
          { consumer_full_name: "横関海翔", amount_jpy: 500, note: "ドリンクB" },
        ],
      },
      {
        // 内訳なし = 全額割勘
        id: SAMPLE_IDS.costCamp,
        title: "キャンプ場利用料",
        category: "lodging",
        total_paid_amount_jpy: 8000,
        currency: "JPY",
        payer_full_name: "横関海翔",
        related_spot_id: null,
        related_day_index: 1,
        is_settled: false,
        note: "",
        individual_breakdown: [],
      },
    ],
    belongings: [
      { id: SAMPLE_IDS.belongingWood, name: "薪", is_needed: true, is_prepared: false, assignee_full_name: "松林凜", note: "" },
    ],
    dishes: [
      {
        id: SAMPLE_IDS.dishNabe,
        name: "坦々餃子鍋",
        status: "decided",
        related_day_index: 1,
        ingredients: [{ name: "餃子", quantity: 2, unit: "袋", ingredient_name: "餃子" }],
      },
    ],
    schedule_conflicts: [],
    notes: "",
  },
};

/**
 * 業務ルール違反サンプル（スキーマは通るが、第5.3・5.4章の各警告が発火するケース）
 * - 総額がカンマ付き文字列 / 0円
 * - 支払者が参加者にいない
 * - 内訳合計が総額超過 / 支払者本人の内訳なし
 * - 固定予約に到着超過（schedule_conflicts未記載）
 * - 同一名称・同一金額・同一日の費用重複
 */
export function makeBrokenSample(): unknown {
  const s = structuredClone(SAMPLE_EXPORT) as VoyageExportInput;
  const t = s.trip;

  t.participants.push({ full_name: "", nickname: "ゲスト", role: "" }); // 本名未入力
  t.lodging = null; // 宿泊未入力

  const lunch = t.days[1].spots[1];
  lunch.arrival_planned = "2026-12-12T12:20:00+09:00"; // 予約12:00 に対し20分超過

  t.costs[0].total_paid_amount_jpy = 10000; // 共通部分だけ入れてしまった誤り
  t.costs[0].individual_breakdown.push({ consumer_full_name: "横関海翔", amount_jpy: 9000, note: "誤入力" });
  t.costs[1].payer_full_name = "かいと"; // ニックネームで入れてしまった誤り
  t.costs.push({ ...structuredClone(t.costs[1]), id: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e10", payer_full_name: "横関海翔" }); // 重複
  t.costs.push({
    ...structuredClone(t.costs[1]),
    id: "6f1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e11",
    title: "ガソリン",
    payer_full_name: "横関海翔",
    individual_breakdown: [{ consumer_full_name: "横関海翔", amount_jpy: 0, note: "" }],
  });

  return s;
}

/** 構造違反サンプル（スキーマ自体が通らないケース） */
export function makeMalformedSample(): unknown {
  const s = structuredClone(SAMPLE_EXPORT) as unknown as {
    exported_at: string;
    trip: { costs: Record<string, unknown>[]; days: { spots: Record<string, unknown>[] }[]; start_date: string };
  };
  s.exported_at = "2026/11/17 22:00"; // 曖昧な日時表記
  s.trip.start_date = "12/12"; // 曖昧な日付表記
  s.trip.costs[0].total_paid_amount_jpy = "11,500"; // カンマ付き文字列
  s.trip.costs[1].total_paid_amount_jpy = "8000"; // 文字列
  s.trip.days[1].spots[0].status = "決まった"; // 日本語の列挙値は禁止
  s.trip.days[1].spots[0].lat = "35.49"; // 緯度が文字列
  return s;
}

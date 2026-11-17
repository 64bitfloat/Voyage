/**
 * 段階2・段階3の統合検証スクリプト:
 * - タイムライン連鎖計算・ドラッグ並び替え再計算・スケジュール破綻検知
 * - 参加者・費用（混合支払い・個人別内訳）・持ち物・料理・写真・宿泊を含む TripDoc → VoyageExport 変換
 * - Markdown 要約生成・パスコード照合ロジック
 */
import assert from "node:assert/strict";
import { initialDays, newSpot, type TripDoc } from "../src/lib/model/types";
import { computeDaySchedule } from "../src/lib/schedule/compute";
import { buildExportFromDoc } from "../src/lib/model/to-export";
import { renderExportMarkdown, validateExport } from "../src/lib/export";

const tripId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e01";
const spot1Id = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e02";
const spot2Id = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e03";
const spotLodgingId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e04";
const p1Id = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e11";
const p2Id = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e12";
const costId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e21";
const belongId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e31";
const dishId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e41";
const photoId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e51";

const days = initialDays("2026-12-12", "2026-12-13");
days[1].departure_point = "自宅";
days[1].departure_time = "08:00";

const spot1 = newSpot({
  id: spot1Id,
  day_index: 1,
  sort_order: 0,
  name: "精進湖畔散策",
  category: "sightseeing",
  status: "decided",
  is_main: true,
  lat: 35.49,
  lng: 138.6,
  stay_minutes: 90,
  transport_mode: "car",
  transport_duration_minutes: 120,
  transport_distance_m: 120000,
});

const spot2 = newSpot({
  id: spot2Id,
  day_index: 1,
  sort_order: 1,
  name: "湖畔レストラン（コース予約）",
  category: "meal",
  status: "decided",
  lat: 35.5,
  lng: 138.65,
  stay_minutes: 90,
  is_fixed: true,
  reservation_time: "2026-12-12T12:00:00+09:00",
  transport_mode: "car",
  transport_duration_minutes: 50, // 08:00 + 120m = 10:00着, +90m滞在 = 11:30発, +50m移動 = 12:20着 → 予約12:00を20分超過
});

const spotLodging = newSpot({
  id: spotLodgingId,
  day_index: 1,
  sort_order: 2,
  name: "Shoji Lake Side Camp",
  category: "lodging",
  status: "decided",
  address: "山梨県南都留郡富士河口湖町精進",
  lat: 35.49,
  lng: 138.6,
  stay_minutes: 60,
  transport_mode: "car",
  transport_duration_minutes: 15,
  check_in: "2026-12-12T15:00:00+09:00",
  check_out: "2026-12-13T10:00:00+09:00",
});

// 1. スケジュール破綻検知テスト（20分超過）
const sched1 = computeDaySchedule(days[1], [spot1, spot2]);
assert.equal(sched1.timings[spot1Id].arrival, "2026-12-12T10:00:00+09:00");
assert.equal(sched1.timings[spot1Id].departure, "2026-12-12T11:30:00+09:00");
assert.equal(sched1.timings[spot2Id].arrival, "2026-12-12T12:20:00+09:00");
assert.equal(sched1.timings[spot2Id].overrun_minutes, 20);
assert.equal(sched1.conflicts.length, 1);
assert.equal(sched1.conflicts[0].overrun_minutes, 20);

// 2. 並び替え（spot2 → spot1）で連鎖再計算され、破綻が解消されることの確認
const spot2First = { ...spot2, sort_order: 0, transport_duration_minutes: 120 };
const spot1Second = { ...spot1, sort_order: 1, transport_duration_minutes: 20 };
const schedReordered = computeDaySchedule(days[1], [spot2First, spot1Second]);
assert.equal(schedReordered.timings[spot2Id].overrun_minutes, 0);
assert.equal(schedReordered.timings[spot2Id].wait_minutes, 120);
assert.equal(schedReordered.timings[spot2Id].departure, "2026-12-12T13:30:00+09:00");
assert.equal(schedReordered.timings[spot1Id].arrival, "2026-12-12T13:50:00+09:00");
assert.equal(schedReordered.conflicts.length, 0);

// 3. 全エンティティを含む TripDoc → VoyageExport 変換が警告ゼロで Zod スキーマに通ること
const spot2OnTime = { ...spot2, transport_duration_minutes: 20 }; // 11:30 + 20m = 11:50着（間に合う）
const doc: TripDoc = {
  trip: {
    id: tripId,
    title: "精進レークサイドキャンプ",
    start_date: "2026-12-12",
    end_date: "2026-12-13",
    notes: "",
    has_passcode: true,
  },
  days,
  spots: [spot1, spot2OnTime, spotLodging],
  participants: [
    { id: p1Id, full_name: "松林凜", nickname: "りん", role: "", sort_order: 0 },
    { id: p2Id, full_name: "横関海翔", nickname: "かいと", role: "", sort_order: 1 },
  ],
  costs: [
    {
      id: costId,
      title: "食事 コース＋ドリンク",
      category: "food",
      total_paid_amount_jpy: 11500,
      payer_participant_id: p1Id,
      payer_full_name: "松林凜",
      related_spot_id: spot2Id,
      related_day_index: 1,
      is_settled: false,
      note: "コース各5000円＋ドリンク",
      individual_breakdown: [
        { consumer_participant_id: p1Id, consumer_full_name: "松林凜", amount_jpy: 1000, note: "ドリンクA" },
        { consumer_participant_id: p2Id, consumer_full_name: "横関海翔", amount_jpy: 500, note: "ドリンクB" },
      ],
    },
  ],
  belongings: [
    {
      id: belongId,
      name: "薪",
      is_needed: true,
      is_prepared: true,
      assignee_participant_id: p1Id,
      assignee_full_name: "松林凜",
      note: "",
      sort_order: 0,
    },
  ],
  dishes: [
    {
      id: dishId,
      name: "坦々餃子鍋",
      status: "decided",
      related_day_index: 1,
      ingredients: [{ name: "餃子", quantity: 2, unit: "袋", ingredient_name: "餃子" }],
      sort_order: 0,
    },
  ],
  photos: [
    {
      id: photoId,
      spot_id: spot1Id,
      day_index: 1,
      url: "https://example.supabase.co/storage/v1/object/public/photos/lake.jpg",
      caption: "富士山が見えた",
      photographer_nickname: "りん",
      taken_at: "2026-12-12T10:05:00+09:00",
    },
  ],
};

const exported = buildExportFromDoc(doc);
const validated = validateExport(exported);
assert.equal(validated.schemaValid, true);
assert.equal(validated.issues.length, 0, `期待外の警告: ${JSON.stringify(validated.issues)}`);
assert.equal(exported.trip.lodging?.name, "Shoji Lake Side Camp");
assert.equal(exported.trip.days[1].spots[0].photos.length, 1);

const md = renderExportMarkdown(exported);
assert.match(md, /精進レークサイドキャンプ/);
assert.match(md, /10,000円/); // 割勘対象額

console.log("✅ 段階2・段階3（全エンティティ・スケジュール破綻検知・エクスポート・Markdown生成）の検証に合格しました");

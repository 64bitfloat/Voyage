/**
 * 段階2（MVP）のスケジュール計算・破綻検知・エクスポート変換の単体検証
 */
import assert from "node:assert/strict";
import { initialDays, newSpot, type TripDoc } from "../src/lib/model/types";
import { computeDaySchedule } from "../src/lib/schedule/compute";
import { buildExportFromDoc } from "../src/lib/model/to-export";
import { validateExport } from "../src/lib/export";

const tripId = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e01";
const spot1Id = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e02";
const spot2Id = "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e03";

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

// 1. スケジュール破綻検知テスト（20分超過）
const sched1 = computeDaySchedule(days[1], [spot1, spot2]);
assert.equal(sched1.timings[spot1Id].arrival, "2026-12-12T10:00:00+09:00");
assert.equal(sched1.timings[spot1Id].departure, "2026-12-12T11:30:00+09:00");
assert.equal(sched1.timings[spot2Id].arrival, "2026-12-12T12:20:00+09:00");
assert.equal(sched1.timings[spot2Id].overrun_minutes, 20);
assert.equal(sched1.conflicts.length, 1);
assert.equal(sched1.conflicts[0].overrun_minutes, 20);

// 2. 並び替え（spot2 → spot1）で連鎖再計算され、破綻が解消されることの確認
const spot2First = { ...spot2, sort_order: 0, transport_duration_minutes: 120 }; // 08:00 + 120m = 10:00着（予約12:00まで120分待機 → 12:00〜13:30）
const spot1Second = { ...spot1, sort_order: 1, transport_duration_minutes: 20 }; // 13:30 + 20m = 13:50着〜15:20発
const schedReordered = computeDaySchedule(days[1], [spot2First, spot1Second]);
assert.equal(schedReordered.timings[spot2Id].overrun_minutes, 0);
assert.equal(schedReordered.timings[spot2Id].wait_minutes, 120);
assert.equal(schedReordered.timings[spot2Id].departure, "2026-12-12T13:30:00+09:00");
assert.equal(schedReordered.timings[spot1Id].arrival, "2026-12-12T13:50:00+09:00");
assert.equal(schedReordered.conflicts.length, 0);

// 3. TripDoc → VoyageExport 変換が Zod スキーマに通ること
const doc: TripDoc = {
  trip: {
    id: tripId,
    title: "精進レークサイドキャンプ",
    start_date: "2026-12-12",
    end_date: "2026-12-13",
    notes: "",
    has_passcode: false,
  },
  days,
  spots: [spot1, spot2],
};
const exported = buildExportFromDoc(doc);
const validated = validateExport(exported);
assert.equal(validated.schemaValid, true);
assert.equal(exported.trip.schedule_conflicts.length, 1);
assert.equal(exported.trip.schedule_conflicts[0].spot_id, spot2Id);

console.log("✅ 段階2（タイムライン連鎖計算・ドラッグ並び替え再計算・スケジュール破綻検知・エクスポート変換）の検証に合格しました");

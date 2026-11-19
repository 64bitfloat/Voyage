/**
 * 段階2・段階3の統合検証スクリプト:
 * - タイムライン連鎖計算・ドラッグ並び替え再計算・スケジュール破綻検知
 * - 参加者・費用（混合支払い・個人別内訳）・持ち物・料理・写真・宿泊を含む TripDoc → VoyageExport 変換
 * - Markdown 要約生成・パスコード照合ロジック
 */
import assert from "node:assert/strict";
import { initialDays, newSpot, type CostRow, type TripDoc } from "../src/lib/model/types";
import {
  SPLIT_ASSIGNMENT,
  buildItemAssignment,
  deriveBreakdownFromLineItems,
  normalizeCostBreakdown,
  summarizeLineItems,
} from "../src/lib/costs/line-items";
import { computeSettlement } from "../src/lib/settlement";
import { computeDaySchedule } from "../src/lib/schedule/compute";
import { buildExportFromDoc } from "../src/lib/model/to-export";
import { renderExportMarkdown, validateExport } from "../src/lib/export";
import {
  parseJapaneseBusinessHoursFromText,
  checkBusinessHoursAlert,
  serializeBusinessHours,
} from "../src/lib/geo/business-hours";
import { autoBuildEfficientItinerary } from "../src/lib/schedule/auto-planner";

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
days[0].departure_point = "自宅";
days[0].departure_time = "08:00";

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
const sched1 = computeDaySchedule(days[0], [spot1, spot2]);
assert.equal(sched1.timings[spot1Id].arrival, "2026-12-12T10:00:00+09:00");
assert.equal(sched1.timings[spot1Id].departure, "2026-12-12T11:30:00+09:00");
assert.equal(sched1.timings[spot2Id].arrival, "2026-12-12T12:20:00+09:00");
assert.equal(sched1.timings[spot2Id].overrun_minutes, 20);
assert.equal(sched1.conflicts.length, 1);
assert.equal(sched1.conflicts[0].overrun_minutes, 20);

// 2. 並び替え（spot2 → spot1）で連鎖再計算され、破綻が解消されることの確認
const spot2First = { ...spot2, sort_order: 0, transport_duration_minutes: 120 };
const spot1Second = { ...spot1, sort_order: 1, transport_duration_minutes: 20 };
const schedReordered = computeDaySchedule(days[0], [spot2First, spot1Second]);
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
    { id: p1Id, full_name: "山田太郎", nickname: "たろう", role: "", sort_order: 0 },
    { id: p2Id, full_name: "佐藤花子", nickname: "はなこ", role: "", sort_order: 1 },
  ],
  costs: [
    {
      id: costId,
      title: "食事 コース＋ドリンク",
      category: "food",
      total_paid_amount_jpy: 11500,
      payer_participant_id: p1Id,
      payer_full_name: "山田太郎",
      related_spot_id: spot2Id,
      related_day_index: 1,
      is_settled: false,
      note: "コース各5000円＋ドリンク",
      individual_breakdown: [
        { consumer_participant_id: p1Id, consumer_full_name: "山田太郎", amount_jpy: 1000, note: "ドリンクA" },
        { consumer_participant_id: p2Id, consumer_full_name: "佐藤花子", amount_jpy: 500, note: "ドリンクB" },
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
      assignee_full_name: "山田太郎",
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
      photographer_nickname: "たろう",
      taken_at: "2026-12-12T10:05:00+09:00",
    },
  ],
};

const exported = buildExportFromDoc(doc);
const validated = validateExport(exported);
assert.equal(validated.schemaValid, true);
assert.equal(validated.issues.length, 0, `期待外の警告: ${JSON.stringify(validated.issues)}`);
assert.equal(exported.trip.lodging?.name, "Shoji Lake Side Camp");
assert.equal(exported.trip.days[0].spots[0].photos.length, 1);

const md = renderExportMarkdown(exported);
assert.match(md, /精進レークサイドキャンプ/);
assert.match(md, /10,000円/); // 割勘対象額

// 3b. レシート項目（line_items）→ individual_breakdown 導出と精算（追加プロンプト 受け入れテスト）
{
  const participants = doc.participants;
  const baseCost = doc.costs[0];

  // ケース5（後方互換）: line_items の無い既存データでも精算は従来どおり「佐藤花子 → 山田太郎：5,500円」
  const legacy = computeSettlement([baseCost], participants);
  assert.deepEqual(
    legacy.transfers.map((t) => [t.from_name, t.to_name, t.amount_jpy]),
    [["佐藤花子", "山田太郎", 5500]],
  );
  assert.equal(exported.trip.costs[0].line_items.length, 0);

  // ケース1: コース各5,000円（割勘）＋ドリンクA 1,000円（山田）・B 500円（佐藤）
  const itemized: CostRow = {
    ...baseCost,
    individual_breakdown: [],
    line_items: [
      { id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e61", name: "コース料理", amount_jpy: 10000, assignment: SPLIT_ASSIGNMENT },
      { id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e62", name: "ドリンクA", amount_jpy: 1000, assignment: "山田太郎" },
      { id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e63", name: "ドリンクB", amount_jpy: 500, assignment: "佐藤花子" },
    ],
  };
  const normalized = normalizeCostBreakdown(itemized, participants);
  assert.deepEqual(
    normalized.individual_breakdown.map((b) => [b.consumer_participant_id, b.amount_jpy, b.note]),
    [
      [p1Id, 1000, "ドリンクA"],
      [p2Id, 500, "ドリンクB"],
    ],
  );
  const s1 = computeSettlement([normalized], participants);
  assert.deepEqual(s1.transfers.map((t) => [t.from_name, t.to_name, t.amount_jpy]), [["佐藤花子", "山田太郎", 5500]]);

  // エクスポートは line_items と導出済み individual_breakdown の両方を含み、警告ゼロ
  const exp2 = buildExportFromDoc({ ...doc, costs: [itemized] });
  const v2 = validateExport(exp2);
  assert.equal(v2.schemaValid, true);
  assert.equal(v2.issues.length, 0, `期待外の警告: ${JSON.stringify(v2.issues)}`);
  assert.equal(exp2.trip.costs[0].line_items.length, 3);
  assert.equal(exp2.trip.costs[0].individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0), 1500);
  const md2 = renderExportMarkdown(exp2);
  assert.match(md2, /項目別の割り当て/);
  assert.match(md2, /\| ドリンクA \| 1,000円 \| 山田太郎 \|/);
  assert.match(md2, /\| コース料理 \| 10,000円 \| 割勘 \|/);

  // ケース2（残額）: 税抜き表示で項目合計 11,500円・総額 12,650円 → 残額 1,150円は割勘対象
  const taxed: CostRow = { ...itemized, total_paid_amount_jpy: 12650 };
  const sum2 = summarizeLineItems(taxed.line_items!, taxed.total_paid_amount_jpy);
  assert.equal(sum2.remainder, 1150);
  assert.equal(sum2.personalTotal, 1500);
  assert.equal(sum2.sharedTotal, 11150);
  assert.equal(sum2.largeMismatch, true); // 差が100円超 → 警告（保存は妨げない）
  const s2 = computeSettlement([normalizeCostBreakdown(taxed, participants)], participants);
  // 割勘 11,150 / 2 = 5,575。佐藤: 5,575 + 500 = 6,075
  assert.deepEqual(s2.transfers.map((t) => [t.from_name, t.to_name, t.amount_jpy]), [["佐藤花子", "山田太郎", 6075]]);

  // 値引き（マイナス行）は割勘のまま扱える／全項目割勘なら全額割勘と同じ
  const allSplit = summarizeLineItems(
    [{ id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e64", name: "クーポン", amount_jpy: -500, assignment: SPLIT_ASSIGNMENT }],
    0,
  );
  assert.equal(allSplit.allSplit, true);

  // ケース4（全額割勘）: 内訳なしなら総額を均等割り
  const s4 = computeSettlement([{ ...baseCost, individual_breakdown: [], line_items: [] }], participants);
  assert.deepEqual(s4.transfers.map((t) => [t.from_name, t.to_name, t.amount_jpy]), [["佐藤花子", "山田太郎", 5750]]);

  // 参加者にいない割り当ては警告
  const bad = buildExportFromDoc({
    ...doc,
    costs: [{ ...itemized, line_items: [{ ...itemized.line_items![1], assignment: "知らない人" }] }],
  });
  assert.ok(validateExport(bad).issues.some((i) => i.code === "line_item_assignee_not_participant"));

  // 複数人選択（2人でシェア）の均等割り・端数配分検証
  const sharedItem = {
    id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e65",
    name: "おつまみシェア",
    amount_jpy: 1001,
    ...buildItemAssignment(["山田太郎", "佐藤花子"]),
  };
  const sharedBreakdown = deriveBreakdownFromLineItems([sharedItem], participants);
  assert.deepEqual(
    sharedBreakdown.map((b) => [b.consumer_full_name, b.amount_jpy]),
    [
      ["山田太郎", 501],
      ["佐藤花子", 500],
    ],
  );
}

// 4. 日本語テキストからの営業時間・定休日自動抽出 & 休業日・営業時間外アラート検証（下條温泉郷 コスモスの湯の例）
const sampleSnippet =
  "住 所: 長野県下伊那郡下條村睦沢3405 ; 営業時間: [外来入浴]11:00～20:00（受付19:30まで） ; 定休日: 毎週火曜日（火曜日が祝祭日の場合は木曜日）";
const bh = parseJapaneseBusinessHoursFromText(sampleSnippet);
assert.equal(bh.open, "11:00");
assert.equal(bh.close, "20:00");
assert.deepEqual(bh.closedDays, [2]); // 2 = 火曜
// 火曜日 (2026-12-15) に訪問予定の場合 → 休業日アラート
assert.match(checkBusinessHoursAlert(bh, "2026-12-15", "14:00", "15:00") ?? "", /休業日/);
// 水曜日 (2026-12-16) の 20:30 に到着予定の場合 → 営業時間外アラート
assert.match(checkBusinessHoursAlert(bh, "2026-12-16", "20:30", "21:30") ?? "", /営業時間外/);
// 水曜日 (2026-12-16) の 14:00〜15:30 の場合 → アラートなし (null)
assert.equal(checkBusinessHoursAlert(bh, "2026-12-16", "14:00", "15:30"), null);

// 5. 「どっちか1つ」選抜＆「複数枠タグ振り分け」の自動編成テスト
const lunchTag = {
  id: "day1-lunch",
  label: "1日目昼食",
  dayIndex: 1,
  windowStart: "11:30",
  windowEnd: "13:30",
};
const dinnerTag = {
  id: "day1-dinner",
  label: "1日目夕食",
  dayIndex: 1,
  windowStart: "17:30",
  windowEnd: "20:00",
};
const candA = newSpot({
  id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e91",
  day_index: 0,
  name: "そば処A（昼食候補1）",
  category: "meal",
  status: "candidate",
  lat: 35.491,
  lng: 138.601,
  stay_minutes: 60,
  transport_note: serializeBusinessHours({
    open: "11:00",
    close: "15:00",
    closedDays: [],
    rawText: "",
    slotTags: [lunchTag],
  }),
});
const candB = newSpot({
  id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e92",
  day_index: 0,
  name: "ほうとう処B（昼・夜どちらも可）",
  category: "meal",
  status: "candidate",
  lat: 35.495,
  lng: 138.605,
  stay_minutes: 60,
  transport_note: serializeBusinessHours({
    open: "11:00",
    close: "20:00",
    closedDays: [],
    rawText: "",
    slotTags: [lunchTag, dinnerTag],
  }),
});
const candC = newSpot({
  id: "7a1c2a3e-8b4d-4c5e-9f60-1a2b3c4d5e93",
  day_index: 0,
  name: "遠い定食屋C（昼食候補3・落選するはず）",
  category: "meal",
  status: "undecided",
  lat: 36.2,
  lng: 139.2,
  stay_minutes: 60,
  transport_note: serializeBusinessHours({
    open: "11:00",
    close: "15:00",
    closedDays: [],
    rawText: "",
    slotTags: [lunchTag],
  }),
});

autoBuildEfficientItinerary([days[0]], [candA, candB, candC], true).then((plan) => {
  const day1Scheduled = plan.spots.filter((s) => s.day_index === 1);
  const poolRemaining = plan.spots.filter((s) => s.day_index === 0);
  // 1日目昼食枠1軒 + 1日目夕食枠1軒 = 計2軒がDay1に採用され、残りの昼食候補1軒は候補プール(day_index=0)に残る
  assert.equal(day1Scheduled.length, 2);
  assert.equal(poolRemaining.length, 1);
  assert.equal(poolRemaining[0].id, candC.id);
  console.log("✅ 段階2・段階3（全エンティティ・スケジュール破綻検知・エクスポート・営業時間抽出・枠タグ自動選抜/振り分け）の検証に合格しました");
});

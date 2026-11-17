/**
 * 第6章スキーマの動作確認: npm run validate:sample
 * 正常系が警告ゼロで通り、異常系で期待した警告がすべて発火することをアサートする。
 */
import assert from "node:assert/strict";
import { validateExport, countBySeverity, type ExportIssue, type IssueCode } from "../src/lib/export";
import { SAMPLE_EXPORT, makeBrokenSample, makeMalformedSample } from "../src/lib/export/sample";
import { toTokyoISO, combineDateTime, diffMinutes } from "../src/lib/datetime";

const icon = { error: "❌", warning: "⚠️ ", info: "ℹ️ " } as const;
const print = (title: string, issues: ExportIssue[]) => {
  console.log(`\n=== ${title} === ${JSON.stringify(countBySeverity(issues))}`);
  for (const i of issues) console.log(`${icon[i.severity]} [${i.code}] ${i.path}\n     ${i.message}`);
};
const codes = (issues: ExportIssue[]) => new Set(issues.map((i) => i.code));
const expectCodes = (issues: ExportIssue[], expected: IssueCode[]) => {
  const got = codes(issues);
  for (const c of expected) assert.ok(got.has(c), `期待した警告 ${c} が発火していません`);
};

// 0. 日時ユーティリティ
assert.equal(toTokyoISO(new Date("2026-12-12T01:00:00Z")), "2026-12-12T10:00:00+09:00");
assert.equal(combineDateTime("2026-12-12", "08:00"), "2026-12-12T08:00:00+09:00");
assert.equal(diffMinutes("2026-12-12T12:20:00+09:00", "2026-12-12T12:00:00+09:00"), 20);

// 1. 正常系
const ok = validateExport(SAMPLE_EXPORT);
print("正常系（第6.2章サンプル＋食事の混合支払い）", ok.issues);
assert.equal(ok.schemaValid, true);
assert.equal(ok.issues.length, 0, "正常系で警告が出ています");
const meal = ok.data!.trip.costs[0];
assert.equal(meal.total_paid_amount_jpy, 11500);
assert.equal(meal.individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0), 1500);
// 割勘対象 = 総額 − 内訳合計 = 10,000円 → 2人で5,000円ずつ（支払者本人のドリンク分が混ざらない）
assert.equal((meal.total_paid_amount_jpy - 1500) / ok.data!.trip.participants.length, 5000);
// JSON往復しても同一（IDが安定・default適用後も同値）
assert.deepEqual(validateExport(JSON.parse(JSON.stringify(ok.data))).data, ok.data);

// 2. 業務ルール違反（スキーマは通る）
const broken = validateExport(makeBrokenSample());
print("業務ルール違反（第5.3・5.4章）", broken.issues);
assert.equal(broken.schemaValid, true);
expectCodes(broken.issues, [
  "missing_required",
  "amount_not_positive",
  "payer_not_participant",
  "breakdown_exceeds_total",
  "schedule_overrun",
  "schedule_conflict_unlisted",
  "duplicate_cost",
]);
const overrun = broken.issues.find((i) => i.code === "schedule_overrun")!;
assert.match(overrun.message, /20分超過/);

// 3. 構造違反（スキーマ不適合）
const bad = validateExport(makeMalformedSample());
print("構造違反（型・形式・列挙値）", bad.issues);
assert.equal(bad.schemaValid, false);
expectCodes(bad.issues, ["amount_has_comma", "amount_not_number", "schema"]);
const paths = bad.issues.map((i) => i.path);
for (const p of ["exported_at", "trip.start_date", "trip.days[1].spots[0].status", "trip.days[1].spots[0].lat"])
  assert.ok(paths.includes(p), `${p} の違反が検出されていません`);

console.log("\n✅ すべてのアサーションに合格しました");

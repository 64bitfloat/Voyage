/**
 * エクスポート前バリデーション（第5.3・5.4・6.3章）
 *
 * 方針: エクスポート自体は禁止しない。問題はすべて ExportIssue の一覧として返し、
 * UI側（エクスポートモーダル）で一覧表示する。
 *
 *   severity
 *   - "error"   : スキーマ違反（型・形式が契約と異なる）。Museが誤読する恐れが高い
 *   - "warning" : 必須項目の未入力・整合性の破綻（総額超過・支払者不在・時刻超過・重複など）
 *   - "info"    : 確認推奨（支払者本人の内訳がない等、正当な場合もあるもの）
 */
import type { z } from "zod";
import { VoyageExportSchema, type VoyageExport, type Spot } from "./schema";
import { diffMinutes } from "../datetime";

export type IssueSeverity = "error" | "warning" | "info";

export interface ExportIssue {
  severity: IssueSeverity;
  code: IssueCode;
  /** JSON上の位置（例: "trip.costs[0].total_paid_amount_jpy"） */
  path: string;
  message: string;
}

export type IssueCode =
  | "schema"
  | "amount_not_number"
  | "amount_has_comma"
  | "amount_not_positive"
  | "missing_required"
  | "payer_not_participant"
  | "consumer_not_participant"
  | "line_item_assignee_not_participant"
  | "line_items_total_mismatch"
  | "assignee_not_participant"
  | "breakdown_exceeds_total"
  | "payer_not_in_breakdown"
  | "schedule_overrun"
  | "schedule_conflict_unlisted"
  | "duplicate_spot"
  | "duplicate_cost"
  | "duplicate_id"
  | "duplicate_participant"
  | "dangling_reference";

export interface ExportValidationResult {
  /** スキーマに適合したか（警告の有無とは無関係） */
  schemaValid: boolean;
  /** スキーマ適合時のみ。default適用済み */
  data?: VoyageExport;
  issues: ExportIssue[];
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/* ------------------------------------------------------------------ */
/* エントリポイント                                                    */
/* ------------------------------------------------------------------ */

export function validateExport(input: unknown): ExportValidationResult {
  const issues: ExportIssue[] = [];

  // 1. 金額の生チェック（スキーマより先に、具体的な理由で警告する）
  const amountPaths = checkRawAmounts(input, issues);

  // 2. スキーマ検証
  const parsed = VoyageExportSchema.safeParse(input, { reportInput: true });
  if (!parsed.success) {
    for (const iss of parsed.error.issues) {
      const path = formatPath(iss.path);
      if (amountPaths.has(path)) continue; // 金額は1で具体的に報告済み
      issues.push({ severity: "error", code: "schema", path, message: describeZodIssue(iss) });
    }
    return { schemaValid: false, issues };
  }

  // 3. 業務ルール検証（型が保証された後に実施）
  const data = parsed.data;
  checkRequiredFields(data, issues);
  checkParticipants(data, issues);
  checkCosts(data, issues);
  checkSchedule(data, issues);
  checkDuplicates(data, issues);
  checkReferences(data, issues);

  return { schemaValid: true, data, issues };
}

/* ------------------------------------------------------------------ */
/* 1. 金額（文字列・カンマ付き・0以下）                                */
/* ------------------------------------------------------------------ */

function checkRawAmounts(input: unknown, issues: ExportIssue[]): Set<string> {
  const reported = new Set<string>();
  const costs = (input as { trip?: { costs?: unknown } } | null)?.trip?.costs;
  if (!Array.isArray(costs)) return reported;

  const check = (value: unknown, path: string, label: string) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        issues.push({ severity: "error", code: "amount_not_number", path, message: `${label}が整数ではありません（${value}）。円単位の整数で入力してください` });
        reported.add(path);
      } else if (value <= 0) {
        issues.push({ severity: "warning", code: "amount_not_positive", path, message: `${label}が0以下です（${value}）` });
      }
      return;
    }
    if (typeof value === "string") {
      if (/[,，]/.test(value)) {
        issues.push({ severity: "error", code: "amount_has_comma", path, message: `${label}がカンマ付きの文字列です（"${value}"）。カンマ・円記号なしの整数にしてください` });
      } else {
        issues.push({ severity: "error", code: "amount_not_number", path, message: `${label}が文字列です（"${value}"）。数値にしてください` });
      }
      reported.add(path);
      return;
    }
    issues.push({ severity: "error", code: "amount_not_number", path, message: `${label}が未入力または数値ではありません` });
    reported.add(path);
  };

  costs.forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    const cost = c as Record<string, unknown>;
    const title = typeof cost.title === "string" && cost.title ? `「${cost.title}」の` : "";
    check(cost.total_paid_amount_jpy, `trip.costs[${i}].total_paid_amount_jpy`, `費用${title}総額`);
    if (Array.isArray(cost.individual_breakdown)) {
      cost.individual_breakdown.forEach((b, j) => {
        if (!b || typeof b !== "object") return;
        check((b as Record<string, unknown>).amount_jpy, `trip.costs[${i}].individual_breakdown[${j}].amount_jpy`, `費用${title}個人別内訳の金額`);
      });
    }
  });
  return reported;
}

/* ------------------------------------------------------------------ */
/* 3a. 必須項目の未入力（第5.3章）                                     */
/* ------------------------------------------------------------------ */

function checkRequiredFields(data: VoyageExport, issues: ExportIssue[]) {
  const t = data.trip;
  const missing = (path: string, message: string) =>
    issues.push({ severity: "warning", code: "missing_required", path, message });

  if (!t.title.trim()) missing("trip.title", "旅行名が未入力です");
  if (!t.start_date) missing("trip.start_date", "開始日が未入力です");
  if (!t.end_date) missing("trip.end_date", "終了日が未入力です");

  // 宿泊
  if (!t.lodging) {
    missing("trip.lodging", "宿泊情報（名称・住所・チェックイン／アウト）が未入力です");
  } else {
    if (!t.lodging.name.trim()) missing("trip.lodging.name", "宿泊先の名称が未入力です");
    if (!t.lodging.address?.trim()) missing("trip.lodging.address", "宿泊先の住所が未入力です");
    if (!t.lodging.check_in) missing("trip.lodging.check_in", "チェックイン日時が未入力です");
    if (!t.lodging.check_out) missing("trip.lodging.check_out", "チェックアウト日時が未入力です");
  }

  // 参加者
  if (t.participants.length === 0) missing("trip.participants", "参加者が1人も登録されていません");
  t.participants.forEach((p, i) => {
    const who = p.nickname || `${i + 1}人目`;
    if (!p.full_name.trim()) missing(`trip.participants[${i}].full_name`, `参加者「${who}」の名前が未入力です`);
  });

  // スポット
  t.days.forEach((d, di) =>
    d.spots.forEach((s, si) => {
      const path = `trip.days[${di}].spots[${si}]`;
      if (!s.name.trim()) missing(`${path}.name`, `${d.label}のスポット${si + 1}の名称が未入力です`);
      if (s.is_fixed && !s.reservation_time)
        missing(`${path}.reservation_time`, `「${s.name}」は固定フラグがありますが予約時刻が未入力です`);
    }),
  );

  // 費用
  t.costs.forEach((c, i) => {
    const path = `trip.costs[${i}]`;
    if (!c.title.trim()) missing(`${path}.title`, `費用${i + 1}件目の名目が未入力です`);
    if (!c.payer_full_name?.trim()) missing(`${path}.payer_full_name`, `費用「${c.title}」の支払者が未入力です`);
  });

  // 持ち物
  t.belongings.forEach((b, i) => {
    if (!b.name.trim()) missing(`trip.belongings[${i}].name`, `持ち物${i + 1}件目の名称が未入力です`);
  });

  // 料理
  t.dishes.forEach((d, i) => {
    const path = `trip.dishes[${i}]`;
    if (!d.name.trim()) missing(`${path}.name`, `料理${i + 1}件目の名称が未入力です`);
    if (d.ingredients.length === 0) missing(`${path}.ingredients`, `料理「${d.name}」の材料が未入力です`);
    d.ingredients.forEach((ing, j) => {
      if (!ing.name.trim()) missing(`${path}.ingredients[${j}].name`, `料理「${d.name}」の材料${j + 1}の名称が未入力です`);
      if (ing.quantity === null) missing(`${path}.ingredients[${j}].quantity`, `料理「${d.name}」の材料「${ing.name}」の分量が未入力です`);
      if (!ing.ingredient_name.trim()) missing(`${path}.ingredients[${j}].ingredient_name`, `料理「${d.name}」の材料「${ing.name}」の食材名が未入力です`);
    });
  });
}

/* ------------------------------------------------------------------ */
/* 3b. 参加者                                                          */
/* ------------------------------------------------------------------ */

function checkParticipants(data: VoyageExport, issues: ExportIssue[]) {
  const seen = new Map<string, number>();
  data.trip.participants.forEach((p, i) => {
    const key = normalizeName(p.full_name);
    if (!key) return;
    if (seen.has(key)) {
      issues.push({ severity: "warning", code: "duplicate_participant", path: `trip.participants[${i}].full_name`, message: `参加者「${p.full_name}」が重複して登録されています` });
    } else seen.set(key, i);
  });

  const names = participantNames(data);
  data.trip.belongings.forEach((b, i) => {
    if (b.assignee_full_name && !names.has(normalizeName(b.assignee_full_name)))
      issues.push({ severity: "warning", code: "assignee_not_participant", path: `trip.belongings[${i}].assignee_full_name`, message: `持ち物「${b.name}」の担当者「${b.assignee_full_name}」が参加者一覧にいません` });
  });
}

/* ------------------------------------------------------------------ */
/* 3c. 費用（第6.3章）                                                 */
/* ------------------------------------------------------------------ */

function checkCosts(data: VoyageExport, issues: ExportIssue[]) {
  const names = participantNames(data);

  data.trip.costs.forEach((c, i) => {
    const path = `trip.costs[${i}]`;

    if (c.payer_full_name?.trim() && !names.has(normalizeName(c.payer_full_name)))
      issues.push({ severity: "warning", code: "payer_not_participant", path: `${path}.payer_full_name`, message: `費用「${c.title}」の支払者「${c.payer_full_name}」が参加者一覧にいません` });

    c.individual_breakdown.forEach((b, j) => {
      if (!b.consumer_full_name.trim())
        issues.push({ severity: "warning", code: "missing_required", path: `${path}.individual_breakdown[${j}].consumer_full_name`, message: `費用「${c.title}」の内訳${j + 1}の対象者が未入力です` });
      else if (!names.has(normalizeName(b.consumer_full_name)))
        issues.push({ severity: "warning", code: "consumer_not_participant", path: `${path}.individual_breakdown[${j}].consumer_full_name`, message: `費用「${c.title}」の内訳の対象者「${b.consumer_full_name}」が参加者一覧にいません` });
    });

    if (c.individual_breakdown.length > 0) {
      const sum = c.individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0);
      if (sum > c.total_paid_amount_jpy)
        issues.push({ severity: "warning", code: "breakdown_exceeds_total", path: `${path}.individual_breakdown`, message: `費用「${c.title}」の個人別内訳の合計（${yen(sum)}）が支払総額（${yen(c.total_paid_amount_jpy)}）を超えています。総額は「実際に支払った総額」を入れてください` });

      // 支払者本人の分の省略は割勘を狂わせる典型ミス（第6.3章）。ただし本人分がない正当なケースもあるため info
      if (c.payer_full_name && !c.individual_breakdown.some((b) => normalizeName(b.consumer_full_name) === normalizeName(c.payer_full_name!)))
        issues.push({ severity: "info", code: "payer_not_in_breakdown", path: `${path}.individual_breakdown`, message: `費用「${c.title}」の内訳に支払者「${c.payer_full_name}」本人の分がありません。本人の個別分（ドリンク等）がある場合は省略せず入れてください` });
    }

    // 項目ごとの割り当て（line_items）: assignment は "split" か参加者の本名（複数人の場合は assignees）
    const items = c.line_items ?? [];
    items.forEach((it, j) => {
      const targets =
        it.assignees && it.assignees.length > 0
          ? it.assignees.filter((a) => a && a !== "split")
          : it.assignment !== "split"
            ? [it.assignment]
            : [];
      for (const who of targets) {
        if (!names.has(normalizeName(who))) {
          issues.push({
            severity: "warning",
            code: "line_item_assignee_not_participant",
            path: `${path}.line_items[${j}].assignment`,
            message: `費用「${c.title}」の項目「${it.name}」の負担者「${who}」が参加者一覧にいません`,
          });
        }
      }
    });
    if (items.length > 0) {
      const itemsTotal = items.reduce((a, it) => a + it.amount_jpy, 0);
      const diff = Math.abs(c.total_paid_amount_jpy - itemsTotal);
      if (diff > 100 || (c.total_paid_amount_jpy > 0 && diff > c.total_paid_amount_jpy * 0.1))
        issues.push({ severity: "info", code: "line_items_total_mismatch", path: `${path}.line_items`, message: `費用「${c.title}」の項目合計（${yen(itemsTotal)}）と支払総額（${yen(c.total_paid_amount_jpy)}）の差が大きいです。読み取り漏れや誤読の可能性があります（残額は割勘対象になります）` });
    }
  });
}

/* ------------------------------------------------------------------ */
/* 3d. スケジュール破綻（第3章）                                       */
/* ------------------------------------------------------------------ */

function checkSchedule(data: VoyageExport, issues: ExportIssue[]) {
  const listed = new Set(data.trip.schedule_conflicts.map((c) => c.spot_id));

  data.trip.days.forEach((d, di) =>
    d.spots.forEach((s, si) => {
      if (!s.is_fixed || !s.reservation_time || !s.arrival_planned) return;
      const over = diffMinutes(s.arrival_planned, s.reservation_time);
      if (over <= 0) return;
      const path = `trip.days[${di}].spots[${si}]`;
      issues.push({ severity: "warning", code: "schedule_overrun", path: `${path}.arrival_planned`, message: `⚠️ 「${s.name}」への移動が間に合いません：${over}分超過（予約 ${s.reservation_time} / 到着予定 ${s.arrival_planned}）` });
      if (!listed.has(s.id))
        issues.push({ severity: "error", code: "schedule_conflict_unlisted", path: "trip.schedule_conflicts", message: `「${s.name}」の時刻超過が schedule_conflicts に含まれていません` });
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 3e. 重複（同一名称・同一金額・同一日）とID重複                      */
/* ------------------------------------------------------------------ */

function checkDuplicates(data: VoyageExport, issues: ExportIssue[]) {
  const t = data.trip;

  // スポット: 同一日 × 同一名称
  const spotKeys = new Map<string, string>();
  t.days.forEach((d, di) =>
    d.spots.forEach((s, si) => {
      const name = normalizeName(s.name);
      if (!name) return;
      const key = `${d.day_index}|${name}`;
      const path = `trip.days[${di}].spots[${si}]`;
      if (spotKeys.has(key))
        issues.push({ severity: "warning", code: "duplicate_spot", path, message: `${d.label}に「${s.name}」が重複している可能性があります（${spotKeys.get(key)} と同名）` });
      else spotKeys.set(key, path);
    }),
  );

  // 費用: 同一名称 × 同一金額 × 同一日
  const costKeys = new Map<string, string>();
  t.costs.forEach((c, i) => {
    const key = `${normalizeName(c.title)}|${c.total_paid_amount_jpy}|${c.related_day_index ?? "-"}`;
    const path = `trip.costs[${i}]`;
    if (costKeys.has(key))
      issues.push({ severity: "warning", code: "duplicate_cost", path, message: `費用「${c.title}」（${yen(c.total_paid_amount_jpy)}）が重複登録されている可能性があります（${costKeys.get(key)} と同一）` });
    else costKeys.set(key, path);
  });

  // ID: 全エンティティ横断で一意
  const ids = new Map<string, string>();
  const reg = (id: string, path: string) => {
    if (ids.has(id))
      issues.push({ severity: "error", code: "duplicate_id", path: `${path}.id`, message: `id ${id} が重複しています（${ids.get(id)}）。IDは一意かつ不変である必要があります` });
    else ids.set(id, path);
  };
  reg(t.id, "trip");
  t.days.forEach((d, di) => {
    d.photos.forEach((p, pi) => reg(p.id, `trip.days[${di}].photos[${pi}]`));
    d.spots.forEach((s, si) => {
      reg(s.id, `trip.days[${di}].spots[${si}]`);
      s.photos.forEach((p, pi) => reg(p.id, `trip.days[${di}].spots[${si}].photos[${pi}]`));
    });
  });
  t.costs.forEach((c, i) => reg(c.id, `trip.costs[${i}]`));
  t.belongings.forEach((b, i) => reg(b.id, `trip.belongings[${i}]`));
  t.dishes.forEach((d, i) => reg(d.id, `trip.dishes[${i}]`));

  // day_index の重複
  const dayIdx = new Set<number>();
  t.days.forEach((d, di) => {
    if (dayIdx.has(d.day_index))
      issues.push({ severity: "error", code: "duplicate_id", path: `trip.days[${di}].day_index`, message: `day_index ${d.day_index} が重複しています` });
    dayIdx.add(d.day_index);
  });
}

/* ------------------------------------------------------------------ */
/* 3f. 参照整合性                                                      */
/* ------------------------------------------------------------------ */

function checkReferences(data: VoyageExport, issues: ExportIssue[]) {
  const t = data.trip;
  const spots = new Map<string, Spot>();
  t.days.forEach((d) => d.spots.forEach((s) => spots.set(s.id, s)));
  const days = new Set(t.days.map((d) => d.day_index));
  const dangling = (path: string, message: string) =>
    issues.push({ severity: "warning", code: "dangling_reference", path, message });

  t.costs.forEach((c, i) => {
    if (c.related_spot_id && !spots.has(c.related_spot_id))
      dangling(`trip.costs[${i}].related_spot_id`, `費用「${c.title}」の関連スポットが存在しません`);
    if (c.related_day_index !== null && !days.has(c.related_day_index))
      dangling(`trip.costs[${i}].related_day_index`, `費用「${c.title}」の関連日程（day_index ${c.related_day_index}）が存在しません`);
  });
  t.dishes.forEach((d, i) => {
    if (d.related_day_index !== null && !days.has(d.related_day_index))
      dangling(`trip.dishes[${i}].related_day_index`, `料理「${d.name}」の関連日程（day_index ${d.related_day_index}）が存在しません`);
  });
  t.schedule_conflicts.forEach((c, i) => {
    if (!spots.has(c.spot_id)) dangling(`trip.schedule_conflicts[${i}].spot_id`, `schedule_conflicts の対象スポット「${c.spot_name}」が存在しません`);
  });
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** 氏名比較用: 全角/半角スペースを除去し NFKC 正規化 */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function participantNames(data: VoyageExport): Set<string> {
  return new Set(data.trip.participants.map((p) => normalizeName(p.full_name)).filter(Boolean));
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

const TYPE_JA: Record<string, string> = {
  number: "数値",
  string: "文字列",
  boolean: "真偽値（true/false）",
  array: "配列",
  object: "オブジェクト",
};

/** Zod既定の英語メッセージを日本語化（スキーマ側で独自メッセージを指定したものはそのまま） */
function describeZodIssue(iss: z.core.$ZodIssue): string {
  switch (iss.code) {
    case "invalid_value":
      return `許可されていない値です（許可される値: ${iss.values.map(String).join(" | ")}）`;
    case "invalid_type":
      if (iss.message.startsWith("Invalid input"))
        return iss.input === undefined
          ? "必須の項目がありません"
          : `型が不正です（${TYPE_JA[iss.expected] ?? iss.expected}である必要があります）`;
      return iss.message;
    case "invalid_format":
      return iss.message.startsWith("Invalid") ? `形式が不正です（${iss.format}）` : iss.message;
    case "too_small":
    case "too_big":
      return iss.message.startsWith("Too") ? `値が範囲外です` : iss.message;
    default:
      return iss.message;
  }
}

/** 件数集計（UIのバッジ用） */
export function countBySeverity(issues: ExportIssue[]) {
  return issues.reduce(
    (acc, i) => ((acc[i.severity] += 1), acc),
    { error: 0, warning: 0, info: 0 } as Record<IssueSeverity, number>,
  );
}

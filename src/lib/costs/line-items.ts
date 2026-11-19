/**
 * 費用の項目（line_items）→ 個人別内訳（individual_breakdown）の導出。
 *
 * - Notion登録と精算計算の正は individual_breakdown。
 * - line_items がある費用では individual_breakdown を必ずここから導出する（保存時・エクスポート時）。
 * - assignment === "split"（かつ assignees が空）は全員で割勘。
 * - 1人または複数人の参加者名が割り当てられた項目は、対象人数で均等割りして参加者ごとに合算する。
 */
import { SPLIT_ASSIGNMENT } from "../export/schema";
import type { CostBreakdownRow, CostLineItemRow, CostRow, ParticipantRow } from "../model/types";

export { SPLIT_ASSIGNMENT };

export function hasLineItems(cost: Pick<CostRow, "line_items">): boolean {
  return (cost.line_items?.length ?? 0) > 0;
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 項目が誰に割り当てられているか（空配列 = 全員で割勘） */
export function getLineItemAssignees(item: Pick<CostLineItemRow, "assignment" | "assignees">): string[] {
  if (item.assignees && item.assignees.length > 0) {
    return item.assignees.filter((a) => a && a !== SPLIT_ASSIGNMENT);
  }
  if (item.assignment && item.assignment !== SPLIT_ASSIGNMENT) {
    return [item.assignment];
  }
  return [];
}

/** 割り当て一覧から assignment 文字列表記と assignees 配列を組み立てる */
export function buildItemAssignment(assignees: string[]): { assignment: string; assignees?: string[] } {
  const unique = Array.from(new Set(assignees.filter((a) => a && a !== SPLIT_ASSIGNMENT)));
  if (unique.length === 0) return { assignment: SPLIT_ASSIGNMENT };
  if (unique.length === 1) return { assignment: unique[0], assignees: unique };
  return { assignment: unique.join(", "), assignees: unique };
}

/** line_items から individual_breakdown を導出する（項目の出現順で参加者を並べる） */
export function deriveBreakdownFromLineItems(
  lineItems: CostLineItemRow[],
  participants: Pick<ParticipantRow, "id" | "full_name">[],
): CostBreakdownRow[] {
  const byName = new Map(participants.map((p) => [norm(p.full_name), p]));
  const groups = new Map<string, { row: CostBreakdownRow; names: string[] }>();

  for (const item of lineItems) {
    const targets = getLineItemAssignees(item);
    if (targets.length === 0) continue;

    const totalAmt = Math.round(item.amount_jpy || 0);
    const n = targets.length;
    const base = Math.trunc(totalAmt / n);
    let rest = totalAmt - base * n;
    const rawName = item.name.trim();
    const notePart = rawName ? (n > 1 ? `${rawName}(${n}人)` : rawName) : n > 1 ? `${n}人で負担` : "";

    for (const target of targets) {
      let share = base;
      if (rest > 0) {
        share += 1;
        rest -= 1;
      } else if (rest < 0) {
        share -= 1;
        rest += 1;
      }
      const key = norm(target);
      const p = byName.get(key);
      let g = groups.get(key);
      if (!g) {
        g = {
          row: {
            consumer_participant_id: p?.id ?? null,
            consumer_full_name: p?.full_name ?? target,
            amount_jpy: 0,
            note: "",
          },
          names: [],
        };
        groups.set(key, g);
      }
      g.row.amount_jpy += share;
      if (notePart) g.names.push(notePart);
    }
  }

  return [...groups.values()].map(({ row, names }) => ({
    ...row,
    note: names.join("、").slice(0, 200),
  }));
}

/**
 * 保存・エクスポート前に必ず通す正規化。
 * line_items がある費用は individual_breakdown を導出値で置き換える。無い費用はそのまま。
 */
export function normalizeCostBreakdown<T extends CostRow>(
  cost: T,
  participants: Pick<ParticipantRow, "id" | "full_name">[],
): T {
  if (!hasLineItems(cost)) return cost;
  return {
    ...cost,
    individual_breakdown: deriveBreakdownFromLineItems(cost.line_items ?? [], participants),
  };
}

export interface LineItemSummary {
  /** 項目の合計金額 */
  itemsTotal: number;
  /** 個人負担に割り当てた分の合計（= individual_breakdown の合計） */
  personalTotal: number;
  /** 割勘に割り当てた項目の合計 */
  splitItemsTotal: number;
  /** 残額 = 総額 − 項目の合計（税・端数など。共通分＝割勘対象） */
  remainder: number;
  /** 割勘対象の合計 = 総額 − 個人負担 */
  sharedTotal: number;
  /** 項目合計と総額が大きくずれている（差が100円超 かつ/または 総額の10%超） */
  largeMismatch: boolean;
  /** 個人負担の合計が総額を超えている */
  personalExceedsTotal: boolean;
  /** 全項目が割勘（= 実質的に全額割勘と同じ結果） */
  allSplit: boolean;
}

export function summarizeLineItems(lineItems: CostLineItemRow[], totalPaid: number): LineItemSummary {
  let itemsTotal = 0;
  let personalTotal = 0;
  let allSplitFlag = lineItems.length > 0;
  for (const it of lineItems) {
    const a = Math.round(it.amount_jpy || 0);
    itemsTotal += a;
    if (getLineItemAssignees(it).length > 0) {
      personalTotal += a;
      allSplitFlag = false;
    }
  }
  const remainder = totalPaid - itemsTotal;
  const diff = Math.abs(remainder);
  return {
    itemsTotal,
    personalTotal,
    splitItemsTotal: itemsTotal - personalTotal,
    remainder,
    sharedTotal: totalPaid - personalTotal,
    largeMismatch: lineItems.length > 0 && (diff > 100 || (totalPaid > 0 && diff > totalPaid * 0.1)),
    personalExceedsTotal: personalTotal > totalPaid,
    allSplit: allSplitFlag && personalTotal === 0,
  };
}

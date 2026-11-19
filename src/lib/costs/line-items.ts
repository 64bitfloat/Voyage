/**
 * 費用の項目（line_items）→ 個人別内訳（individual_breakdown）の導出。
 *
 * - Notion登録と精算計算の正は individual_breakdown。
 * - line_items がある費用では individual_breakdown を必ずここから導出する（保存時・エクスポート時）。
 * - assignment が参加者名の項目を参加者ごとに合算し、note に元の項目名を入れる。
 * - "split"（割勘）の項目と、項目化されていない残額（税・端数など）は共通分＝割勘対象になる。
 */
import { SPLIT_ASSIGNMENT } from "../export/schema";
import type { CostBreakdownRow, CostLineItemRow, CostRow, ParticipantRow } from "../model/types";

export { SPLIT_ASSIGNMENT };

export function hasLineItems(cost: Pick<CostRow, "line_items">): boolean {
  return (cost.line_items?.length ?? 0) > 0;
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** line_items から individual_breakdown を導出する（項目の出現順で参加者を並べる） */
export function deriveBreakdownFromLineItems(
  lineItems: CostLineItemRow[],
  participants: Pick<ParticipantRow, "id" | "full_name">[],
): CostBreakdownRow[] {
  const byName = new Map(participants.map((p) => [norm(p.full_name), p]));
  const groups = new Map<string, { row: CostBreakdownRow; names: string[] }>();

  for (const item of lineItems) {
    if (!item.assignment || item.assignment === SPLIT_ASSIGNMENT) continue;
    const key = norm(item.assignment);
    const p = byName.get(key);
    let g = groups.get(key);
    if (!g) {
      g = {
        row: {
          consumer_participant_id: p?.id ?? null,
          consumer_full_name: p?.full_name ?? item.assignment,
          amount_jpy: 0,
          note: "",
        },
        names: [],
      };
      groups.set(key, g);
    }
    g.row.amount_jpy += Math.round(item.amount_jpy || 0);
    if (item.name.trim()) g.names.push(item.name.trim());
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
  for (const it of lineItems) {
    const a = Math.round(it.amount_jpy || 0);
    itemsTotal += a;
    if (it.assignment !== SPLIT_ASSIGNMENT) personalTotal += a;
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
    allSplit: lineItems.length > 0 && personalTotal === 0 && lineItems.every((it) => it.assignment === SPLIT_ASSIGNMENT),
  };
}

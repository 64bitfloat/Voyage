/**
 * 精算計算。individual_breakdown だけを見る（line_items は事前に normalizeCostBreakdown で導出済みであること）。
 *
 * 各費用について:
 *   - 支払者は総額を立て替えた（paid += total）
 *   - 個人別内訳はその参加者の負担（owed += amount）
 *   - 残り（総額 − 内訳合計）は参加者全員で均等割り（端数1円は参加者の並び順で先頭から配分）
 * 残高 = paid − owed。マイナスの人からプラスの人へ、送金回数が少なくなるよう貪欲に組み合わせる。
 */
import type { CostRow, ParticipantRow } from "./model/types";

export interface SettlementBalance {
  participant_id: string;
  full_name: string;
  nickname: string;
  paid: number;
  owed: number;
  /** paid − owed（プラス = 受け取る、マイナス = 支払う） */
  balance: number;
}

export interface SettlementTransfer {
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount_jpy: number;
}

export interface SettlementResult {
  balances: SettlementBalance[];
  transfers: SettlementTransfer[];
  /** 精算対象にした費用の件数（is_settled=true は除外） */
  includedCostCount: number;
  /** 支払者や内訳の対象者が参加者一覧に見つからず、計算から外した金額がある */
  warnings: string[];
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function computeSettlement(
  costs: CostRow[],
  participants: ParticipantRow[],
  { includeSettled = false }: { includeSettled?: boolean } = {},
): SettlementResult {
  const ordered = [...participants].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const balances = new Map<string, SettlementBalance>(
    ordered.map((p) => [
      p.id,
      { participant_id: p.id, full_name: p.full_name, nickname: p.nickname, paid: 0, owed: 0, balance: 0 },
    ]),
  );
  const byName = new Map(ordered.map((p) => [norm(p.full_name), p.id]));
  const resolve = (id: string | null, name: string | null): string | null => {
    if (id && balances.has(id)) return id;
    if (name && byName.has(norm(name))) return byName.get(norm(name))!;
    return null;
  };

  const warnings: string[] = [];
  let included = 0;
  const n = ordered.length;

  for (const c of costs) {
    if (c.is_settled && !includeSettled) continue;
    if (n === 0) break;
    included += 1;

    const payer = resolve(c.payer_participant_id, c.payer_full_name);
    if (!payer) {
      warnings.push(`費用「${c.title}」の支払者が参加者一覧にいないため、精算から除外しました`);
      continue;
    }
    balances.get(payer)!.paid += c.total_paid_amount_jpy;

    let personal = 0;
    for (const b of c.individual_breakdown) {
      const who = resolve(b.consumer_participant_id, b.consumer_full_name);
      if (!who) {
        // 対象者不明の個別分は共通分として扱う（総額から差し引かない）
        warnings.push(`費用「${c.title}」の内訳「${b.consumer_full_name || "対象者未設定"}」は参加者一覧にいないため割勘に含めました`);
        continue;
      }
      balances.get(who)!.owed += b.amount_jpy;
      personal += b.amount_jpy;
    }

    const shared = c.total_paid_amount_jpy - personal;
    const base = Math.trunc(shared / n);
    let rest = shared - base * n; // 符号は shared と同じ
    for (const p of ordered) {
      let share = base;
      if (rest > 0) {
        share += 1;
        rest -= 1;
      } else if (rest < 0) {
        share -= 1;
        rest += 1;
      }
      balances.get(p.id)!.owed += share;
    }
  }

  const list = [...balances.values()].map((b) => ({ ...b, balance: b.paid - b.owed }));

  // 貪欲法で送金リストを作る
  const debtors = list.filter((b) => b.balance < 0).map((b) => ({ ...b, rest: -b.balance }));
  const creditors = list.filter((b) => b.balance > 0).map((b) => ({ ...b, rest: b.balance }));
  debtors.sort((a, b) => b.rest - a.rest);
  creditors.sort((a, b) => b.rest - a.rest);
  const transfers: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].rest, creditors[j].rest);
    if (amt > 0) {
      transfers.push({
        from_id: debtors[i].participant_id,
        from_name: debtors[i].full_name,
        to_id: creditors[j].participant_id,
        to_name: creditors[j].full_name,
        amount_jpy: amt,
      });
    }
    debtors[i].rest -= amt;
    creditors[j].rest -= amt;
    if (debtors[i].rest === 0) i += 1;
    if (creditors[j].rest === 0) j += 1;
  }

  return { balances: list, transfers, includedCostCount: included, warnings };
}

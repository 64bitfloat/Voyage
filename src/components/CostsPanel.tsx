"use client";

import { useState } from "react";
import { Wallet, Plus, Trash2, AlertTriangle, Info, Edit3 } from "lucide-react";
import type { CostBreakdownRow, CostRow, DayRow, ParticipantRow, SpotRow } from "@/lib/model/types";

interface CostsPanelProps {
  costs: CostRow[];
  participants: ParticipantRow[];
  days: DayRow[];
  spots: SpotRow[];
  onUpsert: (cost: CostRow) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const COST_CATEGORIES: { value: CostRow["category"]; label: string }[] = [
  { value: "food", label: "飲食" },
  { value: "lodging", label: "宿泊" },
  { value: "transport", label: "交通・移動" },
  { value: "ticket", label: "チケット・入場" },
  { value: "shopping", label: "買い物" },
  { value: "other", label: "その他" },
];

function emptyDraft(participants: ParticipantRow[]): CostRow {
  const first = participants[0];
  return {
    id: crypto.randomUUID(),
    title: "",
    category: "food",
    total_paid_amount_jpy: 0,
    payer_participant_id: first?.id ?? null,
    payer_full_name: first?.full_name ?? null,
    related_spot_id: null,
    related_day_index: 1,
    is_settled: false,
    note: "",
    individual_breakdown: [],
  };
}

export default function CostsPanel({
  costs,
  participants,
  days,
  spots,
  onUpsert,
  onDelete,
}: CostsPanelProps) {
  const [draft, setDraft] = useState<CostRow>(() => emptyDraft(participants));
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  const breakdownSum = draft.individual_breakdown.reduce((acc, b) => acc + (b.amount_jpy || 0), 0);
  const sharedAmount = draft.total_paid_amount_jpy - breakdownSum;
  const exceedsTotal = draft.individual_breakdown.length > 0 && breakdownSum > draft.total_paid_amount_jpy;
  const payerMissingInBreakdown =
    draft.individual_breakdown.length > 0 &&
    draft.payer_full_name &&
    !draft.individual_breakdown.some((b) => b.consumer_full_name === draft.payer_full_name);

  function handleSelectPayer(participantId: string) {
    const p = participants.find((x) => x.id === participantId);
    setDraft((d) => ({
      ...d,
      payer_participant_id: p ? p.id : null,
      payer_full_name: p ? p.full_name : null,
    }));
  }

  function handleAddBreakdownRow() {
    const p = participants[0];
    const row: CostBreakdownRow = {
      consumer_participant_id: p?.id ?? null,
      consumer_full_name: p?.full_name ?? "",
      amount_jpy: 0,
      note: "",
    };
    setDraft((d) => ({ ...d, individual_breakdown: [...d.individual_breakdown, row] }));
  }

  function handleUpdateBreakdownRow(idx: number, patch: Partial<CostBreakdownRow>) {
    setDraft((d) => ({
      ...d,
      individual_breakdown: d.individual_breakdown.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    }));
  }

  function handleRemoveBreakdownRow(idx: number) {
    setDraft((d) => ({
      ...d,
      individual_breakdown: d.individual_breakdown.filter((_, i) => i !== idx),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      await onUpsert({
        ...draft,
        title: draft.title.trim(),
        total_paid_amount_jpy: Math.round(Number(draft.total_paid_amount_jpy) || 0),
        individual_breakdown: draft.individual_breakdown.map((b) => ({
          ...b,
          amount_jpy: Math.round(Number(b.amount_jpy) || 0),
        })),
      });
      setDraft(emptyDraft(participants));
      setIsEditingExisting(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 第6.3章ルールガイド */}
      <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200 p-3 text-xs text-emerald-950 space-y-1">
        <div className="font-extrabold flex items-center gap-1.5">
          <Wallet className="w-4 h-4 text-emerald-600" />
          <span>Notion精算ルール（費用＋個別費用の同時入力）</span>
        </div>
        <p className="text-[11px] leading-relaxed text-emerald-900">
          ・<strong>支払総額</strong>には共通部分だけでなく「レジで実際に支払った総額」を入力してください。
          <br />
          ・コース＋各自のドリンクのような混合支払いでは、<strong>支払者本人の個別分も含めて</strong>「個人別内訳」に入力してください（残り {sharedAmount.toLocaleString("ja-JP")}円 が全員での割勘対象になります）。
        </p>
      </div>

      {/* 統合入力フォーム（総額＋支払者＋個人別内訳を1画面で完結） */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs space-y-3.5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-slate-800">
            {isEditingExisting ? "費用を編集" : "費用を追加（総額＋個人別内訳）"}
          </h3>
          {isEditingExisting && (
            <button
              type="button"
              onClick={() => {
                setDraft(emptyDraft(participants));
                setIsEditingExisting(false);
              }}
              className="text-xs text-slate-500 hover:underline"
            >
              新規追加に戻る
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-5">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">名目 *</label>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="例: 食事 コース＋ドリンク"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">カテゴリ</label>
            <select
              value={draft.category}
              onChange={(e) =>
                setDraft((d) => ({ ...d, category: e.target.value as CostRow["category"] }))
              }
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-4">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              実際に支払った総額（円・整数）*
            </label>
            <input
              type="number"
              required
              step={1}
              value={draft.total_paid_amount_jpy || ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  total_paid_amount_jpy: Math.round(Number(e.target.value) || 0),
                }))
              }
              placeholder="例: 11500"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono font-bold"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              支払った参加者（本名）*
            </label>
            <select
              value={draft.payer_participant_id ?? ""}
              onChange={(e) => handleSelectPayer(e.target.value)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">-- 参加者を選択 --</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}（{p.nickname}）
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">関連日程</label>
            <select
              value={draft.related_day_index ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  related_day_index: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">指定なし</option>
              {days.map((d) => (
                <option key={d.day_index} value={d.day_index}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">関連スポット</label>
            <select
              value={draft.related_spot_id ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, related_spot_id: e.target.value || null }))
              }
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">指定なし</option>
              {spots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 個人別内訳（同じフォーム内に統合） */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-xs font-bold text-slate-800">
                個人別内訳（個別費用DB用・空なら全額が割勘対象）
              </span>
              <span className="ml-2 text-[11px] font-mono text-slate-600">
                個別計: {breakdownSum.toLocaleString("ja-JP")}円 / 割勘対象:{" "}
                <strong className={sharedAmount < 0 ? "text-red-600" : "text-emerald-700"}>
                  {sharedAmount.toLocaleString("ja-JP")}円
                </strong>
              </span>
            </div>
            <button
              type="button"
              onClick={handleAddBreakdownRow}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-semibold hover:bg-slate-100"
            >
              <Plus className="w-3 h-3" />
              個人別内訳を追加
            </button>
          </div>

          {draft.individual_breakdown.map((b, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
              <div className="col-span-5">
                <select
                  value={b.consumer_participant_id ?? ""}
                  onChange={(e) => {
                    const p = participants.find((x) => x.id === e.target.value);
                    handleUpdateBreakdownRow(idx, {
                      consumer_participant_id: p?.id ?? null,
                      consumer_full_name: p?.full_name ?? "",
                    });
                  }}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="">対象者を選択</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}（{p.nickname}）
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <input
                  type="number"
                  step={1}
                  value={b.amount_jpy || ""}
                  onChange={(e) =>
                    handleUpdateBreakdownRow(idx, {
                      amount_jpy: Math.round(Number(e.target.value) || 0),
                    })
                  }
                  placeholder="金額(円)"
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                />
              </div>
              <div className="col-span-3">
                <input
                  type="text"
                  value={b.note}
                  onChange={(e) => handleUpdateBreakdownRow(idx, { note: e.target.value })}
                  placeholder="例: ドリンクA"
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleRemoveBreakdownRow(idx)}
                  className="p-1 text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {exceedsTotal && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 font-bold bg-red-50 px-2.5 py-1.5 rounded-xl">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                個人別内訳の合計（{breakdownSum.toLocaleString("ja-JP")}円）が支払総額（
                {draft.total_paid_amount_jpy.toLocaleString("ja-JP")}円）を超えています！
              </span>
            </div>
          )}

          {payerMissingInBreakdown && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-xl">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                支払者本人（{draft.payer_full_name}）の内訳が含まれていません。本人のドリンク代等がある場合は省略せず追加してください。
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="メモ（例: コース各5000円＋ドリンク）"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            {isEditingExisting ? "更新する" : "費用を保存"}
          </button>
        </div>
      </form>

      {/* 登録済み費用一覧 */}
      <div className="space-y-2">
        {costs.map((c) => {
          const sum = c.individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0);
          const shared = c.total_paid_amount_jpy - sum;
          return (
            <div
              key={c.id}
              className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-2xs flex items-start justify-between gap-2"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-extrabold text-slate-900">{c.title}</span>
                  <span className="text-sm font-mono font-extrabold text-blue-600">
                    ¥{c.total_paid_amount_jpy.toLocaleString("ja-JP")}
                  </span>
                  <span className="text-xs text-slate-500">
                    支払: <strong>{c.payer_full_name ?? "未設定"}</strong>
                  </span>
                </div>
                <div className="text-xs text-slate-600">
                  割勘対象: ¥{shared.toLocaleString("ja-JP")}
                  {c.individual_breakdown.length > 0 && (
                    <span className="ml-2 text-slate-500">
                      （個別:{" "}
                      {c.individual_breakdown
                        .map(
                          (b) =>
                            `${b.consumer_full_name} ¥${b.amount_jpy.toLocaleString("ja-JP")}${
                              b.note ? ` [${b.note}]` : ""
                            }`,
                        )
                        .join(" / ")}
                      ）
                    </span>
                  )}
                </div>
                {c.note && <div className="text-[11px] text-slate-400">{c.note}</div>}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(structuredClone(c));
                    setIsEditingExisting(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                  title="編集"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

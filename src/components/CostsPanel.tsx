"use client";

import { useMemo, useRef, useState } from "react";
import {
  Wallet,
  Plus,
  Trash2,
  AlertTriangle,
  Info,
  Edit3,
  Camera,
  ScanText,
  Receipt,
  ListChecks,
  Users,
  ArrowRight,
  Loader2,
  X,
  ImagePlus,
} from "lucide-react";
import type {
  CostBreakdownRow,
  CostLineItemRow,
  CostReceiptRow,
  CostRow,
  DayRow,
  ParticipantRow,
  SpotRow,
} from "@/lib/model/types";
import {
  SPLIT_ASSIGNMENT,
  deriveBreakdownFromLineItems,
  hasLineItems,
  normalizeCostBreakdown,
  summarizeLineItems,
} from "@/lib/costs/line-items";
import { computeSettlement } from "@/lib/settlement";
import { compressReceiptFile, receiptUrlToUploadable } from "@/lib/photo/receipt-image";
import { toTokyoISO } from "@/lib/datetime";

interface CostsPanelProps {
  tripId: string;
  costs: CostRow[];
  participants: ParticipantRow[];
  days: DayRow[];
  spots: SpotRow[];
  onUpsert: (cost: CostRow) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type SplitMode = "all" | "items";

interface ReceiptAnalysis {
  merchant: string | null;
  items: { name: string; quantity: number | null; amount_jpy: number | null }[];
  total_jpy: number | null;
  subtotal_jpy: number | null;
  tax_jpy: number | null;
}

const COST_CATEGORIES: { value: CostRow["category"]; label: string }[] = [
  { value: "food", label: "飲食" },
  { value: "lodging", label: "宿泊" },
  { value: "transport", label: "交通・移動" },
  { value: "ticket", label: "チケット・入場" },
  { value: "shopping", label: "買い物" },
  { value: "other", label: "その他" },
];

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

const inputCls =
  "w-full px-3 py-2 rounded-xl border border-slate-200 bg-white/80 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";
const smallInputCls =
  "w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";

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
    line_items: [],
    receipts: [],
  };
}

function newLineItem(partial: Partial<CostLineItemRow> = {}): CostLineItemRow {
  return { id: crypto.randomUUID(), name: "", amount_jpy: 0, assignment: SPLIT_ASSIGNMENT, ...partial };
}

export default function CostsPanel({
  tripId,
  costs,
  participants,
  days,
  spots,
  onUpsert,
  onDelete,
}: CostsPanelProps) {
  const [draft, setDraft] = useState<CostRow>(() => emptyDraft(participants));
  const [mode, setMode] = useState<SplitMode>("all");
  const [manualBreakdownOpen, setManualBreakdownOpen] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // レシート関連
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [ocrMsg, setOcrMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [suggestedTotal, setSuggestedTotal] = useState<number | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const readAfterAttach = useRef(false);

  const lineItems = useMemo(() => draft.line_items ?? [], [draft.line_items]);
  const receipts = draft.receipts ?? [];
  const summary = summarizeLineItems(lineItems, draft.total_paid_amount_jpy);
  const derivedBreakdown = useMemo(
    () => deriveBreakdownFromLineItems(lineItems, participants),
    [lineItems, participants],
  );

  // 従来方式（個人別内訳の直接入力）の集計
  const breakdownSum = draft.individual_breakdown.reduce((acc, b) => acc + (b.amount_jpy || 0), 0);
  const sharedAmount = draft.total_paid_amount_jpy - breakdownSum;
  const exceedsTotal = draft.individual_breakdown.length > 0 && breakdownSum > draft.total_paid_amount_jpy;
  const payerMissingInBreakdown =
    draft.individual_breakdown.length > 0 &&
    draft.payer_full_name &&
    !draft.individual_breakdown.some((b) => b.consumer_full_name === draft.payer_full_name);

  // 精算（保存済みの費用。line_items は導出を通してから計算する）
  const settlement = useMemo(
    () =>
      computeSettlement(
        costs.map((c) => normalizeCostBreakdown(c, participants)),
        participants,
      ),
    [costs, participants],
  );

  function resetForm() {
    setDraft(emptyDraft(participants));
    setMode("all");
    setManualBreakdownOpen(false);
    setIsEditingExisting(false);
    setOcrMsg(null);
    setSuggestedTotal(null);
    setSaveErr(null);
  }

  function startEdit(c: CostRow) {
    const copy = structuredClone(c);
    copy.line_items = copy.line_items ?? [];
    copy.receipts = copy.receipts ?? [];
    setDraft(copy);
    // 一度「項目ごとに分ける」で保存した費用は項目エディタで開く
    setMode(hasLineItems(copy) ? "items" : "all");
    setManualBreakdownOpen(!hasLineItems(copy) && copy.individual_breakdown.length > 0);
    setIsEditingExisting(true);
    setOcrMsg(null);
    setSuggestedTotal(null);
    setSaveErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSelectPayer(participantId: string) {
    const p = participants.find((x) => x.id === participantId);
    setDraft((d) => ({
      ...d,
      payer_participant_id: p ? p.id : null,
      payer_full_name: p ? p.full_name : null,
    }));
  }

  /* ---------------- 従来方式: 個人別内訳 ---------------- */

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

  /* ---------------- 項目エディタ ---------------- */

  function updateItem(id: string, patch: Partial<CostLineItemRow>) {
    setDraft((d) => ({
      ...d,
      line_items: (d.line_items ?? []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  }

  function addItem() {
    setDraft((d) => ({ ...d, line_items: [...(d.line_items ?? []), newLineItem()] }));
  }

  function removeItem(id: string) {
    setDraft((d) => ({ ...d, line_items: (d.line_items ?? []).filter((it) => it.id !== id) }));
  }

  /* ---------------- レシート添付・読み取り ---------------- */

  async function handleAttachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachBusy(true);
    setOcrMsg(null);
    const added: CostReceiptRow[] = [];
    try {
      for (const f of Array.from(files).slice(0, 10 - receipts.length)) {
        if (!f.type.startsWith("image/")) continue;
        const url = await compressReceiptFile(f);
        added.push({ id: crypto.randomUUID(), url, created_at: toTokyoISO(new Date()) });
      }
      if (added.length === 0) {
        setOcrMsg({ kind: "error", text: "画像ファイルを選択してください。" });
        return;
      }
      setDraft((d) => ({ ...d, receipts: [...(d.receipts ?? []), ...added] }));
      if (readAfterAttach.current) await analyzeReceipt(added[0]);
    } catch (e) {
      setOcrMsg({ kind: "error", text: e instanceof Error ? e.message : "画像の添付に失敗しました" });
    } finally {
      readAfterAttach.current = false;
      setAttachBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openFilePicker(readAfter: boolean) {
    readAfterAttach.current = readAfter;
    const el = fileRef.current;
    if (!el) return;
    // 「撮影して読み取る」はカメラを直接起動、「添付」はアルバムからも選べるようにする
    if (readAfter) el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.multiple = !readAfter;
    el.click();
  }

  function removeReceipt(id: string) {
    setDraft((d) => ({ ...d, receipts: (d.receipts ?? []).filter((r) => r.id !== id) }));
  }

  async function analyzeReceipt(rc: CostReceiptRow) {
    if (lineItems.some((it) => it.name.trim() || it.amount_jpy !== 0)) {
      if (!window.confirm("現在の項目リストを、レシートの読み取り結果で置き換えますか？")) return;
    }
    setOcrBusyId(rc.id);
    setOcrMsg(null);
    setSuggestedTotal(null);
    try {
      const image = await receiptUrlToUploadable(rc.url);
      const res = await fetch(`/api/trips/${tripId}/receipts/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const json = (await res.json().catch(() => null)) as (ReceiptAnalysis & { error?: string }) | null;
      if (!res.ok || !json) {
        setOcrMsg({
          kind: "error",
          text: `${json?.error ?? "レシートの読み取りに失敗しました。"} 下の項目エディタで手入力できます。`,
        });
        if (lineItems.length === 0) setDraft((d) => ({ ...d, line_items: [newLineItem()] }));
        return;
      }
      const items = json.items
        .filter((it) => it.name || it.amount_jpy !== null)
        .map((it) =>
          newLineItem({
            name: (it.quantity && it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name).slice(0, 200),
            amount_jpy: it.amount_jpy ?? 0,
          }),
        );
      setDraft((d) => ({
        ...d,
        title: d.title.trim() ? d.title : (json.merchant ?? d.title),
        line_items: items.length > 0 ? items : [newLineItem()],
        // 総額が未入力ならレシートの合計を初期値にする
        total_paid_amount_jpy:
          !d.total_paid_amount_jpy && json.total_jpy && json.total_jpy > 0 ? json.total_jpy : d.total_paid_amount_jpy,
      }));
      if (json.total_jpy && json.total_jpy > 0 && draft.total_paid_amount_jpy && json.total_jpy !== draft.total_paid_amount_jpy) {
        setSuggestedTotal(json.total_jpy);
      }
      setOcrMsg({
        kind: "info",
        text:
          items.length > 0
            ? `${items.length}件の項目を読み取りました（下書き）。名称・金額・負担者を確認・修正してから保存してください。`
            : "項目を読み取れませんでした。手入力で追加してください。",
      });
    } catch (e) {
      setOcrMsg({
        kind: "error",
        text: `${e instanceof Error ? e.message : "レシートの読み取りに失敗しました"}。下の項目エディタで手入力できます。`,
      });
    } finally {
      setOcrBusyId(null);
    }
  }

  /* ---------------- 保存 ---------------- */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    setSaveErr(null);
    try {
      const total = Math.round(Number(draft.total_paid_amount_jpy) || 0);
      let payload: CostRow;
      if (mode === "items") {
        const items = lineItems
          .map((it) => ({ ...it, name: it.name.trim(), amount_jpy: Math.round(Number(it.amount_jpy) || 0) }))
          .filter((it) => it.name || it.amount_jpy !== 0);
        payload = normalizeCostBreakdown(
          { ...draft, title: draft.title.trim(), total_paid_amount_jpy: total, line_items: items },
          participants,
        );
        if (items.length === 0) payload.individual_breakdown = [];
      } else {
        payload = {
          ...draft,
          title: draft.title.trim(),
          total_paid_amount_jpy: total,
          line_items: [],
          individual_breakdown: manualBreakdownOpen
            ? draft.individual_breakdown.map((b) => ({ ...b, amount_jpy: Math.round(Number(b.amount_jpy) || 0) }))
            : [],
        };
      }
      await onUpsert(payload);
      resetForm();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const assignmentOptions = (current: string) => {
    const known = participants.some((p) => p.full_name === current);
    return (
      <>
        <option value={SPLIT_ASSIGNMENT}>割勘</option>
        {participants.map((p) => (
          <option key={p.id} value={p.full_name}>
            {p.full_name}
            {p.nickname ? `（${p.nickname}）` : ""}
          </option>
        ))}
        {current !== SPLIT_ASSIGNMENT && !known && <option value={current}>{current}（参加者にいません）</option>}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* 精算サマリー */}
      <SettlementCard settlement={settlement} participantsCount={participants.length} />

      {/* 統合入力フォーム */}
      <form onSubmit={handleSubmit} className="liquid-glass rounded-3xl p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-[var(--theme-accent-text)]" />
            {isEditingExisting ? "費用を編集" : "費用を追加"}
          </h3>
          {isEditingExisting && (
            <button type="button" onClick={resetForm} className="text-xs text-slate-500 hover:underline">
              新規追加に戻る
            </button>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-600 bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] rounded-xl px-2.5 py-1.5">
          支払総額には「レジで実際に支払った総額」を入力してください。個人ごとの分（各自のドリンク等）は、支払者本人の分も含めて個人負担にします。残りは全員で割勘になります。
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-5">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">名目 *</label>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="例: 食事 コース＋ドリンク"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">カテゴリ</label>
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as CostRow["category"] }))}
              className={inputCls}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">実際に支払った総額（円）*</label>
            <input
              type="number"
              required
              min={1}
              step={1}
              value={draft.total_paid_amount_jpy || ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, total_paid_amount_jpy: Math.round(Number(e.target.value) || 0) }))
              }
              placeholder="例: 11500"
              className={`${inputCls} font-mono font-bold`}
            />
            {suggestedTotal !== null && suggestedTotal !== draft.total_paid_amount_jpy && (
              <button
                type="button"
                onClick={() => {
                  setDraft((d) => ({ ...d, total_paid_amount_jpy: suggestedTotal }));
                  setSuggestedTotal(null);
                }}
                className="mt-1 text-[11px] font-bold text-[var(--theme-accent-text)] hover:underline"
              >
                レシートの合計 {yen(suggestedTotal)} を総額にする
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">支払った参加者（本名）*</label>
            <select
              value={draft.payer_participant_id ?? ""}
              onChange={(e) => handleSelectPayer(e.target.value)}
              className={inputCls}
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
            <label className="block text-[11px] font-bold text-slate-600 mb-1">関連日程</label>
            <select
              value={draft.related_day_index ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  related_day_index: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              className={inputCls}
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
            <label className="block text-[11px] font-bold text-slate-600 mb-1">関連スポット</label>
            <select
              value={draft.related_spot_id ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, related_spot_id: e.target.value || null }))}
              className={inputCls}
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

        {/* 費用の扱い: 全額割勘 / 項目ごとに分ける */}
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">費用の分け方</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { v: "all", label: "全額割勘", sub: "総額と支払者だけ", Icon: Users },
                { v: "items", label: "項目ごとに分ける", sub: "レシート読み取り可", Icon: ListChecks },
              ] as const
            ).map(({ v, label, sub, Icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setMode(v);
                  if (v === "items" && lineItems.length === 0 && receipts.length === 0) {
                    setDraft((d) => ({ ...d, line_items: [newLineItem()] }));
                  }
                }}
                className={`rounded-2xl px-3 py-2.5 text-left border transition ${
                  mode === v
                    ? "bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white shadow-[0_6px_16px_-6px_rgba(15,23,42,0.35)]"
                    : "bg-white/70 border-slate-200 text-slate-700 hover:bg-white"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-extrabold">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </div>
                <div className={`text-[10px] mt-0.5 ${mode === v ? "text-white/80" : "text-slate-500"}`}>{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* レシート添付 */}
        <div className="rounded-2xl bg-white/60 border border-slate-200 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
              レシート（{receipts.length}枚）
            </span>
            <div className="flex items-center gap-1.5">
              {mode === "items" && receipts.length === 0 && (
                <button
                  type="button"
                  disabled={attachBusy || ocrBusyId !== null}
                  onClick={() => openFilePicker(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl liquid-btn-primary text-white text-[11px] font-bold disabled:opacity-50"
                >
                  <Camera className="w-3.5 h-3.5" />
                  撮影して読み取る
                </button>
              )}
              <button
                type="button"
                disabled={attachBusy || receipts.length >= 10}
                onClick={() => openFilePicker(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {attachBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                添付
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleAttachFiles(e.target.files)}
            />
          </div>

          {receipts.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {receipts.map((rc) => (
                <div key={rc.id} className="shrink-0 w-28 space-y-1">
                  <div className="relative h-28 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={rc.url} alt="レシート" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReceipt(rc.id)}
                      className="absolute top-1 right-1 p-0.5 rounded-full bg-black/50 text-white"
                      title="添付を外す"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {mode === "items" && (
                    <button
                      type="button"
                      disabled={ocrBusyId !== null}
                      onClick={() => analyzeReceipt(rc)}
                      className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg liquid-btn-primary text-white text-[10px] font-bold disabled:opacity-50"
                    >
                      {ocrBusyId === rc.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ScanText className="w-3 h-3" />
                      )}
                      {ocrBusyId === rc.id ? "読み取り中…" : "レシートから読み取る"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {mode === "items" && (
            <p className="text-[10px] text-slate-500 flex items-start gap-1">
              <Info className="w-3 h-3 mt-px shrink-0" />
              レシート画像は読み取りのため外部サービス（Microsoft Azure）へ送信されます。
            </p>
          )}

          {ocrMsg && (
            <div
              className={`flex items-start gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl ${
                ocrMsg.kind === "error"
                  ? "bg-amber-50 text-amber-900 border border-amber-200"
                  : "bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]"
              }`}
            >
              {ocrMsg.kind === "error" ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              ) : (
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              )}
              <span>{ocrMsg.text}</span>
            </div>
          )}
        </div>

        {/* 項目エディタ */}
        {mode === "items" && (
          <div className="rounded-2xl bg-white/60 border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">項目と負担の割り当て</span>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="w-3 h-3" />
                項目を追加
              </button>
            </div>

            {lineItems.length === 0 && (
              <p className="text-[11px] text-slate-500">
                項目がありません。レシートから読み取るか、「項目を追加」で手入力してください。
              </p>
            )}

            <div className="space-y-1.5">
              {lineItems.map((it) => (
                <div key={it.id} className="grid grid-cols-12 gap-1.5 items-center">
                  <input
                    type="text"
                    value={it.name}
                    onChange={(e) => updateItem(it.id, { name: e.target.value })}
                    placeholder="項目名（例: ドリンクA）"
                    className={`${smallInputCls} col-span-5`}
                  />
                  <input
                    type="number"
                    step={1}
                    value={Number.isFinite(it.amount_jpy) && it.amount_jpy !== 0 ? it.amount_jpy : ""}
                    onChange={(e) => updateItem(it.id, { amount_jpy: Math.round(Number(e.target.value) || 0) })}
                    placeholder="金額"
                    className={`${smallInputCls} col-span-3 font-mono ${it.amount_jpy < 0 ? "text-amber-700" : ""}`}
                  />
                  <select
                    value={it.assignment}
                    onChange={(e) => updateItem(it.id, { assignment: e.target.value })}
                    className={`${smallInputCls} col-span-3 ${
                      it.assignment === SPLIT_ASSIGNMENT ? "" : "font-bold text-[var(--theme-accent-text)]"
                    }`}
                  >
                    {assignmentOptions(it.assignment)}
                  </select>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="p-1 text-slate-400 hover:text-red-600"
                      title="項目を削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 常時表示の集計 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
              <SummaryCell label="項目の合計" value={yen(summary.itemsTotal)} />
              <SummaryCell label="個人負担の合計" value={yen(summary.personalTotal)} strong />
              <SummaryCell label="残額（税・端数など）" value={yen(summary.remainder)} />
              <SummaryCell label="割勘対象の合計" value={yen(summary.sharedTotal)} strong />
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              残額 = 総額 − 項目の合計。項目化されていない税・端数などは自動的に共通分（割勘の対象）になります。値引き・クーポンはマイナス金額の項目として入力できます。
            </p>

            {derivedBreakdown.length > 0 && (
              <div className="rounded-xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] px-2.5 py-1.5 text-[11px] text-[var(--theme-accent-text)]">
                <span className="font-bold">個人別内訳（自動導出）: </span>
                {derivedBreakdown.map((b) => `${b.consumer_full_name} ${yen(b.amount_jpy)}`).join(" / ")}
              </div>
            )}

            {summary.allSplit && (
              <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>全項目が「割勘」なので、実質的に全額割勘と同じ結果になります。</span>
              </div>
            )}

            {summary.personalExceedsTotal && (
              <div className="flex items-start gap-1.5 text-xs text-red-700 font-bold bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-xl">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  個人負担の合計（{yen(summary.personalTotal)}）が支払総額（{yen(draft.total_paid_amount_jpy)}
                  ）を超えています。
                </span>
              </div>
            )}

            {summary.largeMismatch && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  項目の合計と総額の差が {yen(Math.abs(summary.remainder))} あります。読み取り漏れや誤読の可能性があります（保存はできます）。
                </span>
              </div>
            )}
          </div>
        )}

        {/* 全額割勘モード: 従来方式の個人別内訳（任意） */}
        {mode === "all" && (
          <div className="rounded-2xl bg-white/60 border border-slate-200 p-3 space-y-2.5">
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={manualBreakdownOpen}
                onChange={(e) => setManualBreakdownOpen(e.target.checked)}
                className="accent-[var(--theme-accent)]"
              />
              個人別内訳を直接入力する（従来方式・空なら全額が割勘対象）
            </label>

            {manualBreakdownOpen && (
              <>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-[11px] font-mono text-slate-600">
                    個別計: {yen(breakdownSum)} / 割勘対象:{" "}
                    <strong className={sharedAmount < 0 ? "text-red-600" : "text-[var(--theme-accent-text)]"}>
                      {yen(sharedAmount)}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleAddBreakdownRow}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold hover:bg-slate-50"
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
                        className={smallInputCls}
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
                          handleUpdateBreakdownRow(idx, { amount_jpy: Math.round(Number(e.target.value) || 0) })
                        }
                        placeholder="金額(円)"
                        className={`${smallInputCls} font-mono`}
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={b.note}
                        onChange={(e) => handleUpdateBreakdownRow(idx, { note: e.target.value })}
                        placeholder="例: ドリンクA"
                        className={smallInputCls}
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
                  <div className="flex items-center gap-1.5 text-xs text-red-700 font-bold bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-xl">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      個人別内訳の合計（{yen(breakdownSum)}）が支払総額（{yen(draft.total_paid_amount_jpy)}）を超えています！
                    </span>
                  </div>
                )}

                {payerMissingInBreakdown && (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl">
                    <Info className="w-4 h-4 shrink-0" />
                    <span>
                      支払者本人（{draft.payer_full_name}）の内訳が含まれていません。本人のドリンク代等がある場合は省略せず追加してください。
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {saveErr && (
          <div className="flex items-center gap-1.5 text-xs text-red-700 font-bold bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-xl">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{saveErr}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="メモ（例: コース各5000円＋ドリンク）"
            className={`${inputCls} flex-1`}
          />
          <button
            type="submit"
            disabled={busy || attachBusy || ocrBusyId !== null}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl liquid-btn-primary text-white text-xs font-bold disabled:opacity-50 shrink-0"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {isEditingExisting ? "更新する" : "費用を保存"}
          </button>
        </div>
      </form>

      {/* 登録済み費用一覧 */}
      <div className="space-y-2">
        {costs.map((raw) => {
          const c = normalizeCostBreakdown(raw, participants);
          const sum = c.individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0);
          const shared = c.total_paid_amount_jpy - sum;
          const items = c.line_items ?? [];
          return (
            <div key={c.id} className="liquid-glass rounded-2xl p-3.5 flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-extrabold text-slate-900">{c.title}</span>
                  <span className="text-sm font-mono font-extrabold text-[var(--theme-accent-text)]">
                    ¥{c.total_paid_amount_jpy.toLocaleString("ja-JP")}
                  </span>
                  <span className="text-xs text-slate-500">
                    支払: <strong>{c.payer_full_name ?? "未設定"}</strong>
                  </span>
                  {items.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]">
                      項目別 {items.length}件
                    </span>
                  )}
                  {(c.receipts?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                      <Receipt className="w-3 h-3" />
                      {c.receipts!.length}
                    </span>
                  )}
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
                  onClick={() => startEdit(raw)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-white/80"
                  title="編集"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`費用「${c.title}」を削除しますか？`)) void onDelete(c.id);
                  }}
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

function SummaryCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-white/80 border border-slate-200 px-2 py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`font-mono ${strong ? "font-extrabold text-[var(--theme-accent-text)]" : "font-bold text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}

function SettlementCard({
  settlement,
  participantsCount,
}: {
  settlement: ReturnType<typeof computeSettlement>;
  participantsCount: number;
}) {
  if (participantsCount === 0) {
    return (
      <div className="liquid-glass rounded-3xl p-4 text-xs text-slate-600">
        精算を表示するには「メンバー」タブで参加者を登録してください。
      </div>
    );
  }
  return (
    <div className="liquid-glass rounded-3xl p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
          <ArrowRight className="w-4 h-4 text-[var(--theme-accent-text)]" />
          精算（誰が誰にいくら払うか）
        </h3>
        <span className="text-[10px] text-slate-500">対象 {settlement.includedCostCount}件・精算済みは除外</span>
      </div>
      {settlement.transfers.length === 0 ? (
        <p className="text-xs text-slate-500">精算の必要はありません。</p>
      ) : (
        <ul className="space-y-1.5">
          {settlement.transfers.map((t) => (
            <li
              key={`${t.from_id}-${t.to_id}`}
              className="flex items-center justify-between rounded-xl bg-white/80 border border-slate-200 px-3 py-2 text-xs"
            >
              <span className="font-bold text-slate-800">
                {t.from_name} <span className="text-slate-400">→</span> {t.to_name}
              </span>
              <span className="font-mono font-extrabold text-[var(--theme-accent-text)]">{yen(t.amount_jpy)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {settlement.balances.map((b) => (
          <div key={b.participant_id} className="rounded-xl bg-white/60 border border-slate-200 px-2 py-1.5 text-[11px]">
            <div className="font-bold text-slate-800 truncate">{b.full_name}</div>
            <div className="text-slate-500 font-mono">
              立替 {yen(b.paid)} / 負担 {yen(b.owed)}
            </div>
            <div
              className={`font-mono font-bold ${
                b.balance > 0 ? "text-[var(--theme-accent-text)]" : b.balance < 0 ? "text-amber-700" : "text-slate-500"
              }`}
            >
              {b.balance > 0 ? `受取 ${yen(b.balance)}` : b.balance < 0 ? `支払 ${yen(-b.balance)}` : "±0"}
            </div>
          </div>
        ))}
      </div>
      {settlement.warnings.length > 0 && (
        <ul className="text-[10px] text-amber-800 space-y-0.5">
          {settlement.warnings.map((w, i) => (
            <li key={i}>・{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

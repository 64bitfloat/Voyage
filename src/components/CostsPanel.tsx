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
  ArrowRight,
  Loader2,
  X,
  ImagePlus,
  Check,
  Users,
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
  buildItemAssignment,
  deriveBreakdownFromLineItems,
  getLineItemAssignees,
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
  "w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";

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
  // true = 完全割勘（全員均等・レシートからは総額のみ抽出）、false = 一部もしくは全部個別会計
  const [isFullSplit, setIsFullSplit] = useState(true);
  const [manualBreakdownOpen, setManualBreakdownOpen] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // レシート関連
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [ocrMsg, setOcrMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [suggestedTotal, setSuggestedTotal] = useState<number | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);

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

  // 登録済み費用のうち、金額超過または品目合計と総額が大きくずれている件数
  const mismatchedCostCount = useMemo(
    () =>
      costs.filter((raw) => {
        const c = normalizeCostBreakdown(raw, participants);
        const sum = c.individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0);
        if (sum > c.total_paid_amount_jpy) return true;
        const items = c.line_items ?? [];
        return items.length > 0 && summarizeLineItems(items, c.total_paid_amount_jpy).largeMismatch;
      }).length,
    [costs, participants],
  );

  function resetForm() {
    setDraft(emptyDraft(participants));
    setIsFullSplit(true);
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
    const hasItems = hasLineItems(copy);
    const hasManual = !hasItems && copy.individual_breakdown.length > 0;
    // 項目リストがある費用は個別会計モードで開く
    setIsFullSplit(!hasItems);
    setManualBreakdownOpen(hasManual);
    setIsEditingExisting(true);
    setOcrMsg(null);
    setSuggestedTotal(null);
    setSaveErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleToggleFullSplit(checked: boolean) {
    setIsFullSplit(checked);
    if (!checked && lineItems.length === 0 && receipts.length === 0) {
      setDraft((d) => ({ ...d, line_items: [newLineItem()] }));
    }
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

  function toggleItemAssignee(item: CostLineItemRow, fullName: string) {
    const current = getLineItemAssignees(item);
    const next = current.includes(fullName)
      ? current.filter((n) => n !== fullName)
      : [...current, fullName];
    updateItem(item.id, buildItemAssignment(next));
  }

  function setItemSplitAll(itemId: string) {
    updateItem(itemId, { assignment: SPLIT_ASSIGNMENT, assignees: undefined });
  }

  function addItem() {
    setDraft((d) => ({ ...d, line_items: [...(d.line_items ?? []), newLineItem()] }));
  }

  function removeItem(id: string) {
    setDraft((d) => ({ ...d, line_items: (d.line_items ?? []).filter((it) => it.id !== id) }));
  }

  /* ---------------- レシート添付・自動読み取り ---------------- */

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
      // 貼った瞬間に自動で読み取る（先頭1枚）
      await analyzeReceipt(added[0], { fullSplitOverride: isFullSplit, skipConfirm: true });
    } catch (e) {
      setOcrMsg({ kind: "error", text: e instanceof Error ? e.message : "画像の添付に失敗しました" });
    } finally {
      setAttachBusy(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (albumInputRef.current) albumInputRef.current.value = "";
    }
  }

  function removeReceipt(id: string) {
    setDraft((d) => ({ ...d, receipts: (d.receipts ?? []).filter((r) => r.id !== id) }));
  }

  async function analyzeReceipt(
    rc: CostReceiptRow,
    opts: { fullSplitOverride?: boolean; skipConfirm?: boolean } = {},
  ) {
    const fullSplitMode = opts.fullSplitOverride ?? isFullSplit;
    if (!fullSplitMode && !opts.skipConfirm && lineItems.some((it) => it.name.trim() || it.amount_jpy !== 0)) {
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
          text: `${json?.error ?? "レシートの読み取りに失敗しました。"} 下の欄で手入力できます。`,
        });
        if (!fullSplitMode && lineItems.length === 0) {
          setDraft((d) => ({ ...d, line_items: [newLineItem()] }));
        }
        return;
      }

      if (fullSplitMode) {
        // 完全割勘のときは総額（および名目が空なら店名）のみ抽出する
        setDraft((d) => ({
          ...d,
          title: d.title.trim() ? d.title : (json.merchant ?? d.title),
          total_paid_amount_jpy:
            json.total_jpy && json.total_jpy > 0 ? json.total_jpy : d.total_paid_amount_jpy,
        }));
        setOcrMsg({
          kind: json.total_jpy ? "info" : "error",
          text: json.total_jpy
            ? `レシートから総額（${yen(json.total_jpy)}）を読み取りました。金額が異なる場合は下で修正してください。`
            : "レシートから合計金額を読み取れませんでした。下の支払総額を手入力してください。",
        });
      } else {
        // 個別会計を含むときは品目と価格・総額を抽出して表示
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
          total_paid_amount_jpy:
            !d.total_paid_amount_jpy && json.total_jpy && json.total_jpy > 0 ? json.total_jpy : d.total_paid_amount_jpy,
        }));
        if (
          json.total_jpy &&
          json.total_jpy > 0 &&
          draft.total_paid_amount_jpy &&
          json.total_jpy !== draft.total_paid_amount_jpy
        ) {
          setSuggestedTotal(json.total_jpy);
        }
        setOcrMsg({
          kind: "info",
          text:
            items.length > 0
              ? `${items.length}件の品目を読み取りました。金額の誤読や割り当て（割勘／誰の負担か）を確認・修正してから保存してください。`
              : "品目を読み取れませんでした。下の項目エディタで手入力してください。",
        });
      }
    } catch (e) {
      setOcrMsg({
        kind: "error",
        text: `${e instanceof Error ? e.message : "レシートの読み取りに失敗しました"}。下の欄で手入力できます。`,
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
      if (!isFullSplit) {
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

  return (
    <div className="space-y-4">
      {/* 精算サマリー */}
      <SettlementCard
        settlement={settlement}
        participantsCount={participants.length}
        mismatchedCostCount={mismatchedCostCount}
      />

      {/* 統合入力フォーム（①名目 → ②完全割勘/個別会計 → ③レシート貼付 → ④総額・品目調整 → ⑤その他情報） */}
      <form onSubmit={handleSubmit} className="liquid-glass rounded-3xl p-4 space-y-4">
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

        {/* STEP 1: 名目・カテゴリ */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-8">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">1. 名目 *</label>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="例: 夕食 居酒屋 / コンビニ（空のままレシートを貼ると店名が入ります）"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-4">
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
        </div>

        {/* STEP 2: 完全割勘か、一部もしくは全部個別会計か */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-bold text-slate-600">2. 会計の分け方</label>
          <label
            className={`flex items-start gap-2.5 rounded-2xl p-3 border cursor-pointer transition ${
              isFullSplit
                ? "bg-[var(--theme-accent-soft)] border-[var(--theme-accent-border)]"
                : "bg-white/75 border-slate-200 hover:bg-white"
            }`}
          >
            <input
              type="checkbox"
              checked={isFullSplit}
              onChange={(e) => handleToggleFullSplit(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[var(--theme-accent)] rounded"
            />
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                完全割勘にする（チェックを外すと一部・全部の個別会計ができます）
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {isFullSplit
                  ? "全員で均等割りします。レシートを貼ると「総額」だけを読み取って自動入力します。"
                  : "レシートから「品目と金額」を読み取り、項目ごとに割勘にするか誰の負担か（複数人選択可）を設定できます。"}
              </p>
            </div>
          </label>
        </div>

        {/* STEP 3: レシート貼り付け（上部配置・貼ると自動読み取り） */}
        <div className="rounded-2xl bg-white/70 border border-slate-200 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                3. レシートを貼る（{receipts.length}枚）
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isFullSplit
                  ? "撮影・添付するとレシートから「合計金額」を自動で読み込みます。"
                  : "撮影・添付するとレシートから「品目・価格・合計金額」を自動で読み込みます。"}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={attachBusy || ocrBusyId !== null || receipts.length >= 10}
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl liquid-btn-primary text-white text-[11px] font-bold disabled:opacity-50"
              >
                {attachBusy || ocrBusyId !== null ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
                撮影して読み込む
              </button>
              <button
                type="button"
                disabled={attachBusy || ocrBusyId !== null || receipts.length >= 10}
                onClick={() => albumInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                画像を選ぶ
              </button>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleAttachFiles(e.target.files)}
            />
            <input
              ref={albumInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleAttachFiles(e.target.files)}
            />
          </div>

          {receipts.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-1">
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
                  <button
                    type="button"
                    disabled={ocrBusyId !== null}
                    onClick={() => analyzeReceipt(rc)}
                    className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold hover:bg-slate-50 disabled:opacity-50"
                  >
                    {ocrBusyId === rc.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ScanText className="w-3 h-3" />
                    )}
                    {ocrBusyId === rc.id ? "読み取り中…" : "再読み取り"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-500 flex items-start gap-1">
            <Info className="w-3 h-3 mt-px shrink-0" />
            レシート画像は読み取りのため外部サービス（Microsoft Azure）へ送信されます。
          </p>

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

        {/* STEP 4: 総額・支払者（＋個別会計のときは品目リスト・割り当て） */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                4. 実際に支払った総額（円・整数）*
              </label>
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
          </div>

          {/* 個別会計モード: 品目と負担者（複数人選択可） */}
          {!isFullSplit && (
            <div className="rounded-2xl bg-white/60 border border-slate-200 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-800">品目ごとの割り当て（複数人選択可）</span>
                  <p className="text-[10px] text-slate-500">
                    品目名や金額に誤読がある場合は直接書き換えて修正できます。誰の支払いかをタップしてください。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  品目を追加
                </button>
              </div>

              {lineItems.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  品目がありません。上でレシートを貼るか、「品目を追加」で手入力してください。
                </p>
              )}

              <div className="space-y-2">
                {lineItems.map((it) => {
                  const selected = getLineItemAssignees(it);
                  const isSplitAll = selected.length === 0;
                  const perPerson =
                    selected.length > 1 ? Math.round((it.amount_jpy || 0) / selected.length) : null;
                  return (
                    <div
                      key={it.id}
                      className="rounded-xl bg-white/85 border border-slate-200 p-2.5 space-y-2"
                    >
                      <div className="grid grid-cols-12 gap-1.5 items-center">
                        <input
                          type="text"
                          value={it.name}
                          onChange={(e) => updateItem(it.id, { name: e.target.value })}
                          placeholder="品目名（例: ドリンクA）"
                          className={`${smallInputCls} col-span-7`}
                        />
                        <div className="col-span-4 relative">
                          <input
                            type="number"
                            step={1}
                            value={Number.isFinite(it.amount_jpy) && it.amount_jpy !== 0 ? it.amount_jpy : ""}
                            onChange={(e) =>
                              updateItem(it.id, { amount_jpy: Math.round(Number(e.target.value) || 0) })
                            }
                            placeholder="金額"
                            className={`${smallInputCls} font-mono pr-6 ${
                              it.amount_jpy < 0 ? "text-amber-700" : ""
                            }`}
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">
                            円
                          </span>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => removeItem(it.id)}
                            className="p-1 text-slate-400 hover:text-red-600"
                            title="品目を削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* 負担割り当てチップ: 割勘 or 参加者複数選択 */}
                      <div className="flex items-center gap-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setItemSplitAll(it.id)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border transition ${
                            isSplitAll
                              ? "bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white"
                              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          {isSplitAll && <Check className="w-3 h-3" />}
                          全員で割勘
                        </button>
                        {participants.map((p) => {
                          const active = selected.includes(p.full_name);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => toggleItemAssignee(it, p.full_name)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border transition ${
                                active
                                  ? "bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white"
                                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {active && <Check className="w-3 h-3" />}
                              {p.nickname || p.full_name}
                            </button>
                          );
                        })}
                        {perPerson !== null && (
                          <span className="ml-auto text-[10px] text-slate-500 font-mono">
                            {selected.length}人で負担（約{yen(perPerson)}/人）
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 常時表示の集計 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
                <SummaryCell label="品目の合計" value={yen(summary.itemsTotal)} />
                <SummaryCell label="個人負担の合計" value={yen(summary.personalTotal)} strong />
                <SummaryCell label="残額（税・端数など）" value={yen(summary.remainder)} />
                <SummaryCell label="割勘対象の合計" value={yen(summary.sharedTotal)} strong />
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                残額 = 総額 − 品目の合計。項目化されていない税・端数などは自動的に共通分（全員で割勘）になります。値引き・クーポンはマイナス金額で入力できます。
              </p>

              {derivedBreakdown.length > 0 && (
                <div className="rounded-xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] px-2.5 py-1.5 text-[11px] text-[var(--theme-accent-text)]">
                  <span className="font-bold">個人別内訳（自動計算）: </span>
                  {derivedBreakdown.map((b) => `${b.consumer_full_name} ${yen(b.amount_jpy)}`).join(" / ")}
                </div>
              )}

              {summary.allSplit && (
                <div className="flex items-start gap-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>全項目が「全員で割勘」なので、実質的に完全割勘と同じ結果になります。</span>
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
                    品目の合計と総額の差が {yen(Math.abs(summary.remainder))} あります。読み取り漏れや誤読の可能性があります（保存はできます）。
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 完全割勘モード時の従来方式（手入力の個人別内訳・折りたたみ） */}
          {isFullSplit && manualBreakdownOpen && (
            <div className="rounded-2xl bg-white/60 border border-slate-200 p-3 space-y-2.5">
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
                    支払者本人（{draft.payer_full_name}）の内訳が含まれていません。
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* STEP 5: その他情報（関連日程・関連スポット・メモ） */}
        <div className="space-y-2.5 pt-2 border-t border-slate-200/80">
          <div className="text-[11px] font-bold text-slate-600">5. その他情報（任意）</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">関連日程</label>
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
              <label className="block text-[10px] font-bold text-slate-500 mb-1">関連スポット</label>
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
        </div>
      </form>

      {/* 登録済み費用一覧 */}
      <div className="space-y-2">
        {costs.map((raw) => {
          const c = normalizeCostBreakdown(raw, participants);
          const sum = c.individual_breakdown.reduce((a, b) => a + b.amount_jpy, 0);
          const shared = c.total_paid_amount_jpy - sum;
          const items = c.line_items ?? [];
          const itemSummary = items.length > 0 ? summarizeLineItems(items, c.total_paid_amount_jpy) : null;
          const personalExceeds = sum > c.total_paid_amount_jpy;
          const hasMismatch = Boolean(itemSummary?.largeMismatch);
          return (
            <div
              key={c.id}
              className={`liquid-glass rounded-2xl p-3.5 space-y-2 ${
                personalExceeds
                  ? "ring-1 ring-[#b84242]/45"
                  : hasMismatch
                    ? "ring-1 ring-amber-400/60"
                    : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
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
                        個別・品目別 {items.length}件
                      </span>
                    )}
                    {(c.receipts?.length ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                        <Receipt className="w-3 h-3" />
                        {c.receipts!.length}
                      </span>
                    )}
                    {personalExceeds ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#fdf3f3] text-[#b84242] border border-[#b84242]/30">
                        <AlertTriangle className="w-3 h-3" />
                        総額超過
                      </span>
                    ) : hasMismatch ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
                        <AlertTriangle className="w-3 h-3" />
                        計算不一致
                      </span>
                    ) : null}
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

              {personalExceeds && (
                <button
                  type="button"
                  onClick={() => startEdit(raw)}
                  className="w-full text-left flex items-start gap-1.5 text-[11px] font-bold text-[#b84242] bg-[#fdf3f3] border border-[#b84242]/30 px-2.5 py-1.5 rounded-xl hover:opacity-90"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    個人負担の合計（{yen(sum)}）が支払総額（{yen(c.total_paid_amount_jpy)}）を超えています。タップして修正してください。
                  </span>
                </button>
              )}

              {!personalExceeds && hasMismatch && itemSummary && (
                <button
                  type="button"
                  onClick={() => startEdit(raw)}
                  className="w-full text-left flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl hover:opacity-90"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    品目の合計（{yen(itemSummary.itemsTotal)}）と総額の差が {yen(Math.abs(itemSummary.remainder))} あります（読み取り漏れや誤読の可能性・タップして修正）。
                  </span>
                </button>
              )}
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
  mismatchedCostCount,
}: {
  settlement: ReturnType<typeof computeSettlement>;
  participantsCount: number;
  mismatchedCostCount: number;
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
      {mismatchedCostCount > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            品目合計と総額が一致しない（または総額を超過している）費用が {mismatchedCostCount} 件あります。下の登録済み費用一覧を確認してください。
          </span>
        </div>
      )}
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

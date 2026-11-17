"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Copy,
  Check,
  Download,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  FileJson,
  FileText,
  Link2,
} from "lucide-react";
import type { TripDoc } from "@/lib/model/types";
import { buildExportFromDoc } from "@/lib/model/to-export";
import { countBySeverity, renderExportMarkdown, validateExport } from "@/lib/export";

interface MuseExportModalProps {
  doc: TripDoc;
  onClose: () => void;
}

export default function MuseExportModal({ doc, onClose }: MuseExportModalProps) {
  const [tab, setTab] = useState<"json" | "md" | "url">("json");
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedJsonUrl, setCopiedJsonUrl] = useState(false);

  const exported = useMemo(() => buildExportFromDoc(doc), [doc]);
  const validation = useMemo(() => validateExport(exported), [exported]);
  const counts = useMemo(() => countBySeverity(validation.issues), [validation.issues]);
  const jsonText = useMemo(() => JSON.stringify(exported, null, 2), [exported]);
  const mdText = useMemo(() => renderExportMarkdown(exported), [exported]);

  useEffect(() => {
    void fetch(`/api/trips/${doc.trip.id}/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    }).catch(() => {});
  }, [doc]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const summaryUrl = `${origin}/trip/${doc.trip.id}/summary`;
  const summaryJsonUrl = `${origin}/trip/${doc.trip.id}/summary?format=json`;

  async function handleCopyJson() {
    await navigator.clipboard.writeText(jsonText);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  }

  function handleDownloadJson() {
    const ymd = exported.exported_at.slice(0, 10).replace(/-/g, "");
    const filename = `voyage-${doc.trip.id}-${ymd}.json`;
    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleCopySummaryUrl(asJson: boolean) {
    await navigator.clipboard.writeText(asJson ? summaryJsonUrl : summaryUrl);
    if (asJson) {
      setCopiedJsonUrl(true);
      setTimeout(() => setCopiedJsonUrl(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-[2500] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white text-slate-900 w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-indigo-50 via-blue-50 to-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                Muse（AI）連携用データを出力
              </h2>
              <p className="text-[11px] text-slate-500">
                schema_version {exported.schema_version} / Notion 9データベース振り分け対応
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* 第5.3・5.4章: エクスポート前バリデーション結果（警告してもエクスポートは禁止しない） */}
          {validation.issues.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-bold">
                すべての必須項目・金額整合性・予約時刻チェックに合格しています。そのままMuseへ渡せます。
              </span>
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-950">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    未入力・確認事項があります（エラー {counts.error} / 警告 {counts.warning} / 情報{" "}
                    {counts.info}）
                  </span>
                </div>
                <span className="text-[10px] text-amber-800">
                  ※当日まで未定の項目がある場合もこのまま出力できます
                </span>
              </div>
              <ul className="max-h-36 overflow-y-auto space-y-1 text-xs text-amber-950 pr-1">
                {validation.issues.map((iss, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 leading-snug">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 mt-0.5 ${
                        iss.severity === "error"
                          ? "bg-red-600 text-white"
                          : iss.severity === "warning"
                            ? "bg-amber-500 text-white"
                            : "bg-blue-600 text-white"
                      }`}
                    >
                      {iss.severity.toUpperCase()}
                    </span>
                    <span>{iss.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* タブ切替: 1. JSON（主形式） / 2. Markdown（副形式） / 3. サマリーURL & 引き渡し手順 */}
          <div className="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setTab("json")}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                tab === "json"
                  ? "bg-white text-indigo-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>1. JSON（主形式）</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("md")}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                tab === "md"
                  ? "bg-white text-indigo-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>2. Markdown（確認用）</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("url")}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                tab === "url"
                  ? "bg-white text-indigo-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>3. サマリーURL・手順</span>
            </button>
          </div>

          {tab === "json" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-slate-600">
                  Museへ引き渡す<strong>主形式のJSON</strong>です。ワンタップでコピーまたはファイル保存できます。
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-xs hover:bg-indigo-700"
                  >
                    {copiedJson ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedJson ? "コピーしました" : "JSONをコピー"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold shadow-xs hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    JSON保存 (.json)
                  </button>
                </div>
              </div>
              <pre className="rounded-2xl bg-slate-950 text-slate-100 p-4 text-[11px] font-mono overflow-x-auto max-h-72 leading-relaxed">
                {jsonText}
              </pre>
            </div>
          )}

          {tab === "md" && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-100 p-2.5 text-xs text-slate-700 flex items-center gap-2">
                <Info className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  このMarkdownは<strong>人間が目視確認するための副形式</strong>です。Museへの受け渡しは必ずJSONまたはサマリーURLを使用してください。
                </span>
              </div>
              <pre className="rounded-2xl bg-slate-900 text-slate-100 p-4 text-xs font-mono overflow-x-auto max-h-72 whitespace-pre-wrap leading-relaxed">
                {mdText}
              </pre>
            </div>
          )}

          {tab === "url" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2.5 bg-slate-50">
                <div className="text-xs font-bold text-slate-800">
                  読み取り専用サマリーページ（ログイン・パスコード不要）
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={summaryUrl}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopySummaryUrl(false)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shrink-0"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedUrl ? "コピー済" : "URLコピー"}
                  </button>
                  <a
                    href={`/trip/${doc.trip.id}/summary`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    title="別タブで開く"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>

                <div className="text-xs font-bold text-slate-800 pt-1">
                  生JSON直リンク（<code>?format=json</code> / JS実行不要）
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={summaryJsonUrl}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopySummaryUrl(true)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 shrink-0"
                  >
                    {copiedJsonUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedJsonUrl ? "コピー済" : "JSON URLコピー"}
                  </button>
                </div>
              </div>

              {/* 第7章: Museへの引き渡し手順 */}
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-2 text-xs text-indigo-950">
                <div className="font-extrabold">Muse（AI）への引き渡し手順（Notion 9DB連携）</div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed text-indigo-900">
                  <li>上の「JSONをコピー」または「サマリーURL」をMuseに貼り付けて渡します。</li>
                  <li>Museは <code>?format=json</code> または貼り付けられたJSONを読み取ります。</li>
                  <li>
                    Museは対象のNotion旅行ページと9つのDB（旅行名・目的地・参加者・費用・個別費用・持ち物・料理・料理材料・食材）のスキーマを<strong>毎回再取得</strong>し、英語標準値を実際の選択肢へ対応付けます。
                  </li>
                  <li>
                    Museは書き込み前に、参加者・日程・費用（支払総額と個人別内訳）の対応付け結果を提示し、確認後に登録します。
                  </li>
                  <li>書き込み後、Notion画面の参加者DB「総清算」で最終精算を確認してください。</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

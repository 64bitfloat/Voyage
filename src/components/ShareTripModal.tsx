"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Copy, Check, Share2, Link2, Hash, Lock } from "lucide-react";
import type { TripDoc } from "@/lib/model/types";

interface ShareTripModalProps {
  doc: TripDoc;
  onClose: () => void;
}

function copyTextFallback(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return copyTextFallback(text);
  } catch {
    return copyTextFallback(text);
  }
}

export default function ShareTripModal({ doc, onClose }: ShareTripModalProps) {
  const [copiedBundle, setCopiedBundle] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // モーダルを開いた時点でサーバー側ストアへ最新データを同期しておく
  useEffect(() => {
    void fetch(`/api/trips/${doc.trip.id}/sync`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    }).catch(() => {});
  }, [doc]);

  // 部屋への直リンクではなく、必ずトップページURLを共有する
  const topPageUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/`;
  }, []);

  // 共有先に貼り付けられるテキスト（トップページURL ＋ 部屋ID）
  const shareBundleText = useMemo(() => {
    return [
      `【Voyage 旅行しおり共有】`,
      `しおり: ${doc.trip.title}`,
      `トップページURL: ${topPageUrl}`,
      `部屋ID: ${doc.trip.id}`,
      `※トップページを開き、「部屋ID」と「4桁の合言葉」を入力して入室してください。`,
    ].join("\n");
  }, [doc.trip.title, doc.trip.id, topPageUrl]);

  async function handleCopyBundle() {
    if (await copyToClipboard(shareBundleText)) {
      setCopiedBundle(true);
      setTimeout(() => setCopiedBundle(false), 2500);
    }
  }

  async function handleCopyUrl() {
    if (await copyToClipboard(topPageUrl)) {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    }
  }

  async function handleCopyId() {
    if (await copyToClipboard(doc.trip.id)) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2500);
    }
  }

  async function handleNativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${doc.trip.title} — Voyage しおり`,
          text: shareBundleText,
        });
      } catch {
        // user cancelled
      }
    } else {
      await handleCopyBundle();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2600] bg-slate-900/40 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="liquid-glass-strong text-slate-900 w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[var(--theme-accent)] text-white flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold">しおり（部屋）を友人に共有</h2>
              <p className="text-[11px] text-slate-500">
                トップページURLと部屋IDを送り、合言葉で入室してもらいます
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

        {/* 案内ボックス */}
        <div className="rounded-2xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] p-3 flex items-start gap-2 text-xs text-slate-800">
          <Lock className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0 mt-0.5" />
          <div className="min-w-0 leading-relaxed">
            セキュリティ保護のため、URLからは必ず<strong>トップページ</strong>が開きます。同行者には下の<strong>「トップページURL＋部屋ID」</strong>と、設定した<strong>「4桁の合言葉」</strong>をお伝えください。
          </div>
        </div>

        {/* 1. 部屋ID */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Hash className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
            <span>部屋ID</span>
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={doc.trip.id}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 bg-white/90 text-xs font-mono text-slate-800"
            />
            <button
              type="button"
              onClick={handleCopyId}
              className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs font-bold hover:bg-slate-50 shrink-0 inline-flex items-center gap-1"
            >
              {copiedId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId ? "コピー済" : "IDコピー"}</span>
            </button>
          </div>
        </div>

        {/* 2. トップページURL */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
            <span>トップページURL</span>
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={topPageUrl}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 bg-white/90 text-xs font-mono text-slate-800"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs font-bold hover:bg-slate-50 shrink-0 inline-flex items-center gap-1"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? "コピー済" : "URLコピー"}</span>
            </button>
          </div>
        </div>

        {/* 3. トップページURLと部屋IDをまとめてコピー / 共有 */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={handleCopyBundle}
            className="w-full py-2.5 px-4 rounded-xl liquid-btn-primary text-white text-xs font-extrabold inline-flex items-center justify-center gap-1.5"
          >
            {copiedBundle ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>
              {copiedBundle
                ? "トップページURLと部屋IDをコピーしました！"
                : "トップページURL＋部屋IDをまとめてコピー"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleNativeShare}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-xs font-extrabold shadow-xs hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-4 h-4" />
            <span>LINE等のアプリで送る（URL＋部屋ID）</span>
          </button>
        </div>
      </div>
    </div>
  );
}

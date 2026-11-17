"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Copy, Check, Share2, Link2, Hash } from "lucide-react";
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

export default function ShareTripModal({ doc, onClose }: ShareTripModalProps) {
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

  const shareUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/trip/${doc.trip.id}`;
  }, [doc.trip.id]);

  async function handleCopyUrl() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedUrl(true);
      } else if (copyTextFallback(shareUrl)) {
        setCopiedUrl(true);
      }
    } catch {
      if (copyTextFallback(shareUrl)) setCopiedUrl(true);
    }
    setTimeout(() => setCopiedUrl(false), 2500);
  }

  async function handleCopyId() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(doc.trip.id);
        setCopiedId(true);
      } else if (copyTextFallback(doc.trip.id)) {
        setCopiedId(true);
      }
    } catch {
      if (copyTextFallback(doc.trip.id)) setCopiedId(true);
    }
    setTimeout(() => setCopiedId(false), 2500);
  }

  async function handleNativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${doc.trip.title} — Voyage しおり`,
          text: `「${doc.trip.title}」の共同編集ルームURL（部屋ID: ${doc.trip.id}）`,
          url: shareUrl,
        });
      } catch {
        // user cancelled
      }
    } else {
      await handleCopyUrl();
    }
  }

  return (
    <div className="fixed inset-0 z-[2600] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white text-slate-900 w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold">共同編集ルームを友人に共有</h2>
              <p className="text-[11px] text-slate-500">
                URLを開くか、トップ画面で部屋IDを入力すると同じ部屋に入れます
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

        {/* 1. 専用URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5 text-blue-600" />
            <span>部屋への直リンクURL</span>
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-mono text-slate-800"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shrink-0 inline-flex items-center gap-1"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? "コピー済" : "コピー"}</span>
            </button>
          </div>
        </div>

        {/* 2. 部屋ID（トップ画面から入る用） */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Hash className="w-3.5 h-3.5 text-indigo-600" />
            <span>部屋ID（トップ画面からIDで入室する場合）</span>
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={doc.trip.id}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-mono text-slate-800"
            />
            <button
              type="button"
              onClick={handleCopyId}
              className="px-3 py-2 rounded-xl bg-slate-200 text-slate-800 text-xs font-bold hover:bg-slate-300 shrink-0 inline-flex items-center gap-1"
            >
              {copiedId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId ? "コピー済" : "IDコピー"}</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleNativeShare}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-xs font-extrabold shadow-xs hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
        >
          <Share2 className="w-4 h-4" />
          <span>LINE等のアプリで送る</span>
        </button>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { X, Copy, Check, Share2, Link2 } from "lucide-react";
import type { TripDoc } from "@/lib/model/types";
import { encodeDocSnapshot } from "@/lib/share/snapshot";

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
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const snap = encodeDocSnapshot(doc);
    return `${origin}/trip/${doc.trip.id}?s=${snap}`;
  }, [doc]);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
      } else if (copyTextFallback(shareUrl)) {
        setCopied(true);
      }
    } catch {
      if (copyTextFallback(shareUrl)) setCopied(true);
    }
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleNativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${doc.trip.title} — Voyage しおり`,
          text: `「${doc.trip.title}」の旅行しおりを共有します`,
          url: shareUrl,
        });
      } catch {
        // user cancelled
      }
    } else {
      await handleCopy();
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
              <h2 className="text-sm font-extrabold">しおりを友人に共有</h2>
              <p className="text-[11px] text-slate-500">
                現在の予定・スポット・費用をすべて含んだ共有リンクです
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

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5 text-blue-600" />
            <span>共有用URL（タップして全選択できます）</span>
          </label>
          <input
            type="text"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-xs font-mono text-slate-800"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={handleCopy}
            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 text-white text-xs font-extrabold shadow-xs hover:bg-blue-700 inline-flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? "コピーしました！" : "URLをコピー"}</span>
          </button>

          <button
            type="button"
            onClick={handleNativeShare}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 text-white text-xs font-extrabold shadow-xs hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-4 h-4" />
            <span>アプリで送る (LINE等)</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          ※予定を変更したあとに再度友人に最新状態を渡したい場合は、もう一度このボタンを押して新しいURLを送ってください（Supabase接続時は同じURLのままリアルタイム同期されます）。
        </p>
      </div>
    </div>
  );
}

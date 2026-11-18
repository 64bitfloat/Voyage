"use client";

import { useState } from "react";
import { Lock, ArrowRight } from "lucide-react";

interface PasscodeGateModalProps {
  tripId: string;
  tripTitle: string;
  onUnlocked: () => void;
}

export default function PasscodeGateModal({
  tripId,
  tripTitle,
  onUnlocked,
}: PasscodeGateModalProps) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) {
      setErr("4桁の数字を入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/passcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: code }),
      });
      if (!res.ok) {
        setErr("合言葉が一致しません");
        return;
      }
      try {
        localStorage.setItem(`voyage:unlocked:${tripId}`, "1");
      } catch {
        // ignore storage errors
      }
      onUnlocked();
    } catch {
      setErr("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[3000] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
      <div className="liquid-glass-strong rounded-3xl w-full max-w-sm p-6 space-y-5 text-center">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-extrabold text-slate-900">{tripTitle}</h2>
          <p className="text-xs text-slate-500">
            このしおりを共同編集するには、4桁の合言葉（パスコード）を入力してください。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            className="w-40 mx-auto block text-center text-2xl tracking-[0.5em] font-mono font-bold px-4 py-3 rounded-2xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {err && <p className="text-xs text-red-600 font-semibold">{err}</p>}

          <button
            type="submit"
            disabled={busy || code.length !== 4}
            className="w-full py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-md hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <span>{busy ? "確認中..." : "ロックを解除する"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

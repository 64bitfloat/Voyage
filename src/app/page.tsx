"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, MapPin, Clock, Sparkles, ArrowRight, Lock } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState("精進レークサイドキャンプ");
  const [startDate, setStartDate] = useState("2026-12-12");
  const [endDate, setEndDate] = useState("2026-12-13");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (passcode && !/^\d{4}$/.test(passcode)) {
      setErr("合言葉は4桁の数字で入力してください（空欄ならロックなし）");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          passcode: passcode || null,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setErr(json.error ?? "作成に失敗しました");
        return;
      }
      if (passcode) {
        try {
          localStorage.setItem(`voyage:unlocked:${json.id}`, "1");
        } catch {
          // ignore
        }
      }
      router.push(`/trip/${json.id}`);
    } catch {
      setErr("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-blue-50 via-[#f5f6f8] to-white text-slate-900 flex flex-col justify-between p-5">
      <div className="mx-auto w-full max-w-md space-y-6 pt-6">
        {/* ブランドヘッダー */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg">
            <Compass className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Voyage</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            友人とURLだけでリアルタイム共同編集できるモバイルしおり。
            <br />
            完成した旅程は構造化JSONでAI（Muse）へ引き渡し、Notionへ登録できます。
          </p>
        </div>

        {/* 新規しおり作成カード */}
        <form
          onSubmit={handleCreate}
          className="rounded-3xl bg-white border border-slate-200/90 shadow-xl p-5 space-y-4"
        >
          <h2 className="text-sm font-extrabold text-slate-900">新しい旅行しおりを作成</h2>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">旅行タイトル *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 精進レークサイドキャンプ"
              className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">開始日</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-2xl border border-slate-300 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">終了日</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-2xl border border-slate-300 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>4桁の合言葉（パスコード・任意）</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="未入力ならロックなし（例: 1234）"
              className="w-full px-3.5 py-2 rounded-2xl border border-slate-300 text-xs font-mono tracking-widest"
            />
            <p className="text-[10px] text-slate-400">
              ※読み取り専用サマリー（<code>/trip/[tripId]/summary</code>）はMuseが読めるようパスコード不要で公開されます。
            </p>
          </div>

          {err && <p className="text-xs text-red-600 font-semibold">{err}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-extrabold shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <span>{busy ? "作成中..." : "新しい旅行しおりを作成"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* 特徴一覧 */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-2xl bg-white border border-slate-200/80 p-3 space-y-1 shadow-2xs">
            <MapPin className="w-4 h-4 text-blue-600 mx-auto" />
            <div className="text-xs font-extrabold">地図ピン留め</div>
            <div className="text-[10px] text-slate-500">検索・タップで追加</div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200/80 p-3 space-y-1 shadow-2xs">
            <Clock className="w-4 h-4 text-emerald-600 mx-auto" />
            <div className="text-xs font-extrabold">破綻を自動検知</div>
            <div className="text-[10px] text-slate-500">OSRM移動時間計算</div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200/80 p-3 space-y-1 shadow-2xs">
            <Sparkles className="w-4 h-4 text-indigo-600 mx-auto" />
            <div className="text-xs font-extrabold">Muse JSON連携</div>
            <div className="text-[10px] text-slate-500">Notion 9DB対応</div>
          </div>
        </div>
      </div>

      <footer className="text-center text-[11px] text-slate-400 py-4">
        Voyage — Mobile-first Collaborative Trip Planner (PWA)
      </footer>
    </main>
  );
}

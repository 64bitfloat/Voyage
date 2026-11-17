"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, MapPin, Clock, Sparkles, ArrowRight } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState("精進レークサイドキャンプ");
  const [startDate, setStartDate] = useState("2026-12-12");
  const [endDate, setEndDate] = useState("2026-12-13");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
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
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setErr(json.error ?? "作成に失敗しました");
        return;
      }
      router.push(`/trip/${json.id}`);
    } catch {
      setErr("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-blue-50 via-white to-neutral-50 text-neutral-900 flex flex-col justify-between p-5">
      <div className="mx-auto w-full max-w-md space-y-6 pt-6">
        {/* ブランドヘッダー */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600 text-white shadow-md">
            <Compass className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Voyage</h1>
          <p className="text-xs text-neutral-600 leading-relaxed">
            友人とURLだけでリアルタイム共同編集。
            <br />
            完成した旅程は構造化JSONでAI（Muse）へ引き渡し、Notionへ登録できます。
          </p>
        </div>

        {/* 新規しおり作成カード */}
        <form
          onSubmit={handleCreate}
          className="rounded-2xl bg-white border border-neutral-200 shadow-lg p-5 space-y-4"
        >
          <h2 className="text-sm font-bold text-neutral-900">新しい旅行しおりを作成</h2>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-neutral-700">旅行タイトル *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 精進レークサイドキャンプ"
              className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700">開始日</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-neutral-700">終了日</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-neutral-300 text-xs"
              />
            </div>
          </div>

          {err && <p className="text-xs text-red-600 font-medium">{err}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-md hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <span>{busy ? "作成中..." : "新しい旅行しおりを作成"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="text-[11px] text-neutral-500 text-center">
            アカウント登録不要。発行された専用URLを友人に送るだけで共同編集できます。
          </p>
        </form>

        {/* 特徴一覧 */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-xl bg-white border border-neutral-200 p-3 space-y-1">
            <MapPin className="w-4 h-4 text-blue-600 mx-auto" />
            <div className="text-xs font-bold">地図ピン留め</div>
            <div className="text-[10px] text-neutral-500">検索・タップで追加</div>
          </div>
          <div className="rounded-xl bg-white border border-neutral-200 p-3 space-y-1">
            <Clock className="w-4 h-4 text-emerald-600 mx-auto" />
            <div className="text-xs font-bold">破綻を自動検知</div>
            <div className="text-[10px] text-neutral-500">OSRM移動時間計算</div>
          </div>
          <div className="rounded-xl bg-white border border-neutral-200 p-3 space-y-1">
            <Sparkles className="w-4 h-4 text-purple-600 mx-auto" />
            <div className="text-xs font-bold">Muse JSON連携</div>
            <div className="text-[10px] text-neutral-500">Notion 9DB対応</div>
          </div>
        </div>
      </div>

      <footer className="text-center text-[11px] text-neutral-400 py-4">
        Voyage — Mobile-first Collaborative Trip Planner
      </footer>
    </main>
  );
}

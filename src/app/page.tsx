"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Compass,
  MapPin,
  Clock,
  Sparkles,
  ArrowRight,
  Lock,
  Calendar,
  Trash2,
  LogIn,
} from "lucide-react";

interface RecentTripItem {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  updatedAt: number;
}

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 部屋ID・共有URLで合流するフォーム用
  const [joinInput, setJoinInput] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);

  const [recentTrips, setRecentTrips] = useState<RecentTripItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("voyage:recent_trips");
      return raw ? (JSON.parse(raw) as RecentTripItem[]) : [];
    } catch {
      return [];
    }
  });

  function handleRemoveRecent(id: string) {
    try {
      const next = recentTrips.filter((t) => t.id !== id);
      setRecentTrips(next);
      localStorage.setItem("voyage:recent_trips", JSON.stringify(next));
    } catch {
      // ignore
    }
  }

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
      try {
        localStorage.setItem(
          `voyage:init:${json.id}`,
          JSON.stringify({
            title: title.trim(),
            start_date: startDate || null,
            end_date: endDate || null,
          }),
        );
      } catch {
        // ignore
      }
      router.push(`/trip/${json.id}`);
    } catch {
      setErr("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    setJoinErr(null);
    const match = joinInput.trim().match(UUID_REGEX);
    if (!match) {
      setJoinErr("有効な部屋ID（UUID）または共有URLを入力してください");
      return;
    }
    const targetId = match[0].toLowerCase();
    if (joinPasscode) {
      if (!/^\d{4}$/.test(joinPasscode)) {
        setJoinErr("合言葉は4桁の数字で入力してください");
        return;
      }
      const res = await fetch(`/api/trips/${targetId}/passcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: joinPasscode }),
      });
      if (!res.ok) {
        setJoinErr("合言葉（パスコード）が一致しません");
        return;
      }
      try {
        localStorage.setItem(`voyage:unlocked:${targetId}`, "1");
      } catch {
        // ignore
      }
    }
    router.push(`/trip/${targetId}`);
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-blue-50 via-[#f5f6f8] to-white text-slate-900 flex flex-col justify-between p-5">
      <div className="mx-auto w-full max-w-md space-y-5 pt-4">
        {/* ブランドヘッダー */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg">
            <Compass className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Voyage</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            友人と部屋ID・URLでリアルタイム共同編集できるモバイルしおり。
            <br />
            完成した旅程は構造化JSONでAI（Muse）へ引き渡し、Notionへ登録できます。
          </p>
        </div>

        {/* 最近開いた・作成したしおり一覧 */}
        <div suppressHydrationWarning>
          {recentTrips.length > 0 && (
            <section className="rounded-3xl bg-white border border-slate-200/90 shadow-md p-4 space-y-2.5">
              <h2 className="text-xs font-extrabold text-slate-700">
                最近編集したしおり（続きから再開）
              </h2>
              <div className="space-y-2">
                {recentTrips.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-blue-50/50 px-3.5 py-2.5 transition"
                  >
                    <Link href={`/trip/${t.id}`} className="flex-1 min-w-0">
                      <div className="text-sm font-extrabold text-slate-900 truncate">
                        {t.title}
                      </div>
                      {t.start_date && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3 text-blue-600" />
                          <span>
                            {t.start_date}
                            {t.end_date ? ` 〜 ${t.end_date}` : ""}
                          </span>
                        </div>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecent(t.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                      title="履歴から外す"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* 新規しおり作成カード */}
        <form
          onSubmit={handleCreate}
          className="rounded-3xl bg-white border border-slate-200/90 shadow-xl p-5 space-y-4"
        >
          <h2 className="text-sm font-extrabold text-slate-900">新しい旅行しおり（部屋）を作成</h2>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">旅行タイトル *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 週末温泉旅行"
              className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">開始日</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setStartDate(val);
                  if (val && (!endDate || endDate < val)) {
                    setEndDate(val);
                  }
                }}
                className="w-full px-3 py-2 rounded-2xl border border-slate-300 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">終了日</label>
              <input
                type="date"
                min={startDate || undefined}
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

        {/* 既存の部屋（しおり）に入るカード */}
        <form
          onSubmit={handleJoinRoom}
          className="rounded-3xl bg-white border border-slate-200/90 shadow-md p-5 space-y-3"
        >
          <h2 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
            <LogIn className="w-4 h-4 text-indigo-600" />
            <span>友人が作成したしおり（部屋）に入る</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="部屋ID または 共有URLを貼り付け"
              className="sm:col-span-2 px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={joinPasscode}
              onChange={(e) => setJoinPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="合言葉(任意)"
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono tracking-widest"
            />
          </div>
          {joinErr && <p className="text-xs text-red-600 font-semibold">{joinErr}</p>}
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>この部屋に入って共同編集する</span>
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

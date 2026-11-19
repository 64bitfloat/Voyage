"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  Check,
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
  const [theme] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("voyage:theme") || "forest";
      } catch {
        // ignore
      }
    }
    return "forest";
  });
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 部屋ID・合言葉で入室するフォーム用
  const [joinInput, setJoinInput] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [selectedRecentTitle, setSelectedRecentTitle] = useState<string | null>(null);
  const joinPasscodeRef = useRef<HTMLInputElement>(null);

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

  function handleSelectRecentTrip(t: RecentTripItem) {
    setJoinInput(t.id);
    setSelectedRecentTitle(t.title);
    setJoinErr(null);
    setTimeout(() => {
      joinPasscodeRef.current?.focus();
    }, 50);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!/^\d{4}$/.test(passcode)) {
      setErr("4桁の合言葉（数字）を設定してください");
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
          passcode,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setErr(json.error ?? "作成に失敗しました");
        return;
      }
      try {
        sessionStorage.setItem(`voyage:entry_ticket:${json.id}`, String(Date.now()));
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
      setJoinErr("有効な部屋ID（UUID）を入力してください");
      return;
    }
    if (!/^\d{4}$/.test(joinPasscode)) {
      setJoinErr("4桁の合言葉（数字）を入力してください");
      return;
    }
    const targetId = match[0].toLowerCase();
    setJoinBusy(true);
    try {
      const res = await fetch(`/api/trips/${targetId}/passcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: joinPasscode }),
      });
      if (!res.ok) {
        setJoinErr("部屋IDまたは合言葉（パスコード）が一致しません");
        return;
      }
      try {
        sessionStorage.setItem(`voyage:entry_ticket:${targetId}`, String(Date.now()));
      } catch {
        // ignore
      }
      router.push(`/trip/${targetId}`);
    } catch {
      setJoinErr("通信エラーが発生しました");
    } finally {
      setJoinBusy(false);
    }
  }

  return (
    <main
      data-theme={theme}
      suppressHydrationWarning
      className="min-h-dvh liquid-canvas text-slate-900 flex flex-col justify-between p-4 sm:p-5 overflow-x-hidden"
    >
      <div className="mx-auto w-full max-w-md space-y-5 pt-4">
        {/* ブランドヘッダー */}
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-3xl bg-[var(--theme-accent)] text-white shadow-lg">
            <Compass className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Voyage</h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            部屋IDと合言葉で友人とリアルタイム共同編集できる旅のしおり。
            <br />
            タイムスケジュール・地図・移動時間の自動計算までまとめて管理できます。
          </p>
        </div>

        {/* 既存の部屋（しおり）に入るカード（ID＋合言葉が必須） */}
        <form
          onSubmit={handleJoinRoom}
          className="rounded-3xl liquid-glass-strong p-5 space-y-3.5"
        >
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <LogIn className="w-4 h-4 text-[var(--theme-accent-text)]" />
            <span>しおり（部屋）に入る</span>
          </h2>

          {selectedRecentTitle && (
            <div className="rounded-xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] px-3 py-2 text-[11px] font-bold text-[var(--theme-accent-text)] flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>「{selectedRecentTitle}」の部屋IDをセットしました。合言葉を入力してください。</span>
            </div>
          )}

          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">部屋ID *</label>
              <input
                type="text"
                required
                value={joinInput}
                onChange={(e) => {
                  const val = e.target.value;
                  const extracted = val.match(UUID_REGEX);
                  setJoinInput(extracted && val.includes("\n") ? extracted[0].toLowerCase() : val);
                  setSelectedRecentTitle(null);
                }}
                placeholder="共有された部屋IDを貼り付け"
                className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/85 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
                <span>4桁の合言葉（パスコード） *</span>
              </label>
              <input
                ref={joinPasscodeRef}
                type="password"
                inputMode="numeric"
                required
                maxLength={4}
                value={joinPasscode}
                onChange={(e) => setJoinPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4桁の数字を入力"
                className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/85 text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
              />
            </div>
          </div>

          {joinErr && <p className="text-xs text-[#b84242] font-semibold">{joinErr}</p>}

          <button
            type="submit"
            disabled={joinBusy}
            className="w-full py-3 rounded-2xl liquid-btn-primary text-white text-xs font-extrabold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <LogIn className="w-4 h-4" />
            <span>{joinBusy ? "認証中..." : "IDと合言葉で部屋に入る"}</span>
          </button>
        </form>

        {/* 最近開いた・作成したしおり一覧（タップすると上のフォームに部屋IDを自動セット） */}
        <div suppressHydrationWarning>
          {recentTrips.length > 0 && (
            <section className="rounded-3xl liquid-glass p-4 space-y-2.5">
              <div>
                <h2 className="text-xs font-extrabold text-slate-700">
                  最近編集したしおり（タップで部屋IDをセット）
                </h2>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  選択後、上の欄で4桁の合言葉を入力すると入室できます
                </p>
              </div>
              <div className="space-y-2">
                {recentTrips.map((t) => {
                  const isSelected = joinInput.trim().toLowerCase() === t.id.toLowerCase();
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 transition ${
                        isSelected
                          ? "border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]"
                          : "border-white/80 bg-white/60 hover:bg-white/90"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectRecentTrip(t)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="text-sm font-extrabold text-slate-900 truncate">
                          {t.title}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          ID: {t.id}
                        </div>
                        {t.start_date && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3 h-3 text-[var(--theme-accent-text)]" />
                            <span>
                              {t.start_date}
                              {t.end_date ? ` 〜 ${t.end_date}` : ""}
                            </span>
                          </div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRecent(t.id)}
                        className="p-1.5 text-slate-400 hover:text-[#b84242] rounded-lg shrink-0"
                        title="履歴から外す"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* 新規しおり作成カード */}
        <form
          onSubmit={handleCreate}
          className="rounded-3xl liquid-glass p-5 space-y-4"
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
              className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/80 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0">
              <label className="block text-xs font-bold text-slate-700">開始日（任意）</label>
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
                className="w-full min-w-0 appearance-none px-3.5 py-2.5 min-h-[42px] rounded-2xl border border-slate-200/90 bg-white/80 text-xs text-slate-800"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <label className="block text-xs font-bold text-slate-700">終了日（任意）</label>
              <input
                type="date"
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full min-w-0 appearance-none px-3.5 py-2.5 min-h-[42px] rounded-2xl border border-slate-200/90 bg-white/80 text-xs text-slate-800"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5 text-[var(--theme-accent-text)]" />
              <span>4桁の合言葉（パスコード・必須） *</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              required
              maxLength={4}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="4桁の数字を設定（例: 1234）"
              className="w-full px-3.5 py-2 rounded-2xl border border-slate-200/90 bg-white/80 text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
            />
            <p className="text-[10px] text-slate-500">
              ※次回入室時や同行者への共有時にこの4桁の合言葉が必要になります。
            </p>
          </div>

          {err && <p className="text-xs text-[#b84242] font-semibold">{err}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-2xl bg-slate-900/90 hover:bg-slate-900 text-white text-sm font-extrabold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <span>{busy ? "作成中..." : "新しい旅行しおりを作成"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* 特徴一覧 */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-2xl liquid-glass p-3 space-y-1">
            <MapPin className="w-4 h-4 text-[var(--theme-accent-text)] mx-auto" />
            <div className="text-xs font-extrabold">地図確認</div>
            <div className="text-[10px] text-slate-500">位置関係・ルート</div>
          </div>
          <div className="rounded-2xl liquid-glass p-3 space-y-1">
            <Clock className="w-4 h-4 text-[var(--theme-accent-text)] mx-auto" />
            <div className="text-xs font-extrabold">移動時間計算</div>
            <div className="text-[10px] text-slate-500">高速優先/回避対応</div>
          </div>
          <div className="rounded-2xl liquid-glass p-3 space-y-1">
            <Sparkles className="w-4 h-4 text-[var(--theme-accent-text)] mx-auto" />
            <div className="text-xs font-extrabold">共同編集</div>
            <div className="text-[10px] text-slate-500">費用・持ち物も管理</div>
          </div>
        </div>
      </div>

      <footer className="mx-auto max-w-md text-center text-[10px] text-slate-400 py-4 space-y-1 leading-relaxed">
        <div>Voyage — Mobile-first Collaborative Trip Planner (PWA)</div>
        <div>
          ※個人開発のためバグや不具合等の個別対応・サポートはいたしかねます（必要に応じてご自身で構築してください）。ギズモード中橋氏の旅行しおりアプリを参考に制作。
        </div>
      </footer>
    </main>
  );
}

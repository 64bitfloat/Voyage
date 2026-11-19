"use client";

import { useState } from "react";
import { Lightbulb, Plus, Trash2, ThumbsUp, AlertCircle, Compass, Backpack } from "lucide-react";
import type { ParticipantRow } from "@/lib/model/types";
import {
  RETRO_CATEGORIES,
  parseRetroNotes,
  serializeRetroNotes,
  type RetroCategory,
  type RetroNoteItem,
} from "@/lib/notes/retrospective";

interface RetroNotesPanelProps {
  notes: string;
  participants: ParticipantRow[];
  onSaveNotes: (nextNotes: string) => Promise<void>;
}

const CAT_ICON: Record<RetroCategory, typeof Lightbulb> = {
  good: ThumbsUp,
  improve: AlertCircle,
  next: Compass,
  packing: Backpack,
};

export default function RetroNotesPanel({
  notes,
  participants,
  onSaveNotes,
}: RetroNotesPanelProps) {
  const items = parseRetroNotes(notes);
  const [category, setCategory] = useState<RetroCategory>("improve");
  const [text, setText] = useState("");
  const [author, setAuthor] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const next: RetroNoteItem[] = [
        ...items,
        { id: `retro-${Date.now()}`, category, text: trimmed, author },
      ];
      await onSaveNotes(serializeRetroNotes(next));
      setText("");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(idx: number) {
    setBusy(true);
    try {
      const next = items.filter((_, i) => i !== idx);
      await onSaveNotes(serializeRetroNotes(next));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] p-3 flex items-start gap-2.5 text-xs text-slate-800">
        <Lightbulb className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="font-bold text-[var(--theme-accent-text)]">次回に活かすメモ（ふりかえり）：</span>
          旅行中に気づいたこと・反省点・次回のアイデアを1項目ずつ登録できます。みんなの意見を集めて次の旅行計画に活かせます。
        </div>
      </div>

      {/* 1項目追加フォーム */}
      <form onSubmit={handleAdd} className="liquid-glass rounded-3xl p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="block text-[11px] font-bold text-slate-700">カテゴリ</label>
          <div className="flex flex-wrap gap-1.5">
            {RETRO_CATEGORIES.map((c) => {
              const active = category === c.value;
              const Icon = CAT_ICON[c.value];
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition ${
                    active
                      ? "bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white"
                      : "bg-white/80 border-slate-200 text-slate-700 hover:bg-white"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-8 min-w-0">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">メモ内容 *</label>
            <input
              type="text"
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="例: 1日目のランチは事前予約が安心 / 懐中電灯が便利だった"
              className="w-full min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-white/85 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]"
            />
          </div>
          <div className="sm:col-span-4 min-w-0">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">投稿者（任意）</label>
            <select
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full min-w-0 px-2.5 py-2 rounded-xl border border-slate-200 bg-white/85 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]"
            >
              <option value="">指定なし</option>
              {participants.map((p) => {
                const name = p.nickname || p.full_name;
                return (
                  <option key={p.id} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl liquid-btn-primary text-white text-xs font-bold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            メモを追加
          </button>
        </div>
      </form>

      {/* 登録済みメモ一覧 */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="liquid-glass rounded-2xl border-dashed p-6 text-center text-xs text-slate-500">
            まだメモがありません。気づいたことがあれば1項目ずつ追加してみてください。
          </div>
        ) : (
          items.map((it, idx) => {
            const catMeta = RETRO_CATEGORIES.find((c) => c.value === it.category) ?? RETRO_CATEGORIES[2];
            const Icon = CAT_ICON[it.category];
            const isImprove = it.category === "improve";
            return (
              <div
                key={`${it.id}-${idx}`}
                className="liquid-glass rounded-2xl p-3.5 flex items-start justify-between gap-2"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isImprove
                          ? "bg-amber-50 text-amber-800 border border-amber-200"
                          : "bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]"
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {catMeta.label}
                    </span>
                    {it.author && (
                      <span className="text-[11px] font-bold text-slate-500">by {it.author}</span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-slate-900 break-words leading-relaxed">
                    {it.text}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDelete(idx)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

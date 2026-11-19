"use client";

import { useState } from "react";
import { Users, Plus, Trash2, AlertCircle } from "lucide-react";
import type { ParticipantRow } from "@/lib/model/types";

interface ParticipantsPanelProps {
  participants: ParticipantRow[];
  onUpsert: (p: ParticipantRow) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const inputCls =
  "w-full min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-white/85 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";

const inlineInputCls =
  "w-full min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white/85 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";

export default function ParticipantsPanel({
  participants,
  onUpsert,
  onDelete,
}: ParticipantsPanelProps) {
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() && !nickname.trim()) return;
    setBusy(true);
    try {
      await onUpsert({
        id: crypto.randomUUID(),
        full_name: fullName.trim(),
        nickname: nickname.trim(),
        role: role.trim(),
        sort_order: participants.length,
      });
      setFullName("");
      setNickname("");
      setRole("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] p-3 flex items-start gap-2.5 text-xs text-slate-800">
        <AlertCircle className="w-4 h-4 text-[var(--theme-accent-text)] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="font-bold text-[var(--theme-accent-text)]">参加者登録のポイント：</span>
          ニックネームだけでなく、<strong>本名（フルネーム）</strong>もあわせて入力してください（費用・精算の支払者や持ち物の担当者の管理に使われます）。
        </div>
      </div>

      {/* 新規追加フォーム */}
      <form onSubmit={handleAdd} className="liquid-glass rounded-3xl p-4 space-y-3">
        <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-[var(--theme-accent-text)]" />
          <span>参加者を追加</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="min-w-0">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              本名（フルネーム）*
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="例: 山田太郎"
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              ニックネーム（表示名）*
            </label>
            <input
              type="text"
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="例: たろう"
              className={inputCls}
            />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              役割（任意）
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="例: 運転・会計"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl liquid-btn-primary text-white text-xs font-bold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            追加する
          </button>
        </div>
      </form>

      {/* 一覧（スマホでも文字がはみ出ないレスポンシブ2段レイアウト／PC・タブレットは横並び） */}
      <div className="space-y-2">
        {participants.length === 0 ? (
          <div className="liquid-glass rounded-2xl border-dashed p-6 text-center text-xs text-slate-500">
            まだ参加者が登録されていません。まずメンバーの本名とニックネームを登録してください。
          </div>
        ) : (
          participants.map((p, idx) => (
            <div
              key={p.id}
              className="liquid-glass rounded-2xl p-3 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="w-6 h-6 rounded-full bg-[var(--theme-accent)] text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    defaultValue={p.full_name}
                    onBlur={(e) => {
                      if (e.target.value !== p.full_name) {
                        void onUpsert({ ...p, full_name: e.target.value.trim() });
                      }
                    }}
                    placeholder="本名（フルネーム）"
                    className={`${inlineInputCls} font-bold`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  className="sm:hidden p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:flex gap-2 sm:items-center min-w-0 pl-8 sm:pl-0">
                <input
                  type="text"
                  defaultValue={p.nickname}
                  onBlur={(e) => {
                    if (e.target.value !== p.nickname) {
                      void onUpsert({ ...p, nickname: e.target.value.trim() });
                    }
                  }}
                  placeholder="ニックネーム"
                  className={`${inlineInputCls} sm:w-32`}
                />
                <input
                  type="text"
                  defaultValue={p.role}
                  onBlur={(e) => {
                    if (e.target.value !== p.role) {
                      void onUpsert({ ...p, role: e.target.value.trim() });
                    }
                  }}
                  placeholder="役割"
                  className={`${inlineInputCls} sm:w-32`}
                />
              </div>

              <button
                type="button"
                onClick={() => onDelete(p.id)}
                className="hidden sm:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                title="削除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

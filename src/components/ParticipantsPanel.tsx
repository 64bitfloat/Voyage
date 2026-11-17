"use client";

import { useState } from "react";
import { Users, Plus, Trash2, AlertCircle } from "lucide-react";
import type { ParticipantRow } from "@/lib/model/types";

interface ParticipantsPanelProps {
  participants: ParticipantRow[];
  onUpsert: (p: ParticipantRow) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

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
      <div className="rounded-2xl bg-blue-50/70 border border-blue-200 p-3 flex items-start gap-2.5 text-xs text-blue-950">
        <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Notion参加者DBとの照合ルール：</span>
          ニックネームだけでなく、必ず<strong>本名（フルネーム）</strong>を入力してください（費用・持ち物の支払者や担当者の照合に使われます）。
        </div>
      </div>

      {/* 新規追加フォーム */}
      <form
        onSubmit={handleAdd}
        className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs space-y-3"
      >
        <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-blue-600" />
          <span>参加者を追加</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              本名（フルネーム）*
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="例: 山田太郎"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              ニックネーム（表示名）*
            </label>
            <input
              type="text"
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="例: たろう"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-700 mb-1">
              役割（任意）
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="例: 運転・会計"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            追加する
          </button>
        </div>
      </form>

      {/* 一覧（インライン編集対応） */}
      <div className="space-y-2">
        {participants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-xs text-slate-500">
            まだ参加者が登録されていません。まずメンバーの本名とニックネームを登録してください。
          </div>
        ) : (
          participants.map((p, idx) => (
            <div
              key={p.id}
              className="rounded-2xl bg-white border border-slate-200 p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shadow-2xs"
            >
              <div className="flex items-center gap-2 flex-1">
                <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <input
                  type="text"
                  defaultValue={p.full_name}
                  onBlur={(e) => {
                    if (e.target.value !== p.full_name) {
                      void onUpsert({ ...p, full_name: e.target.value.trim() });
                    }
                  }}
                  placeholder="本名（フルネーム）"
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
                />
                <input
                  type="text"
                  defaultValue={p.nickname}
                  onBlur={(e) => {
                    if (e.target.value !== p.nickname) {
                      void onUpsert({ ...p, nickname: e.target.value.trim() });
                    }
                  }}
                  placeholder="ニックネーム"
                  className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs"
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
                  className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs hidden sm:block"
                />
              </div>
              <button
                type="button"
                onClick={() => onDelete(p.id)}
                className="self-end sm:self-center p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
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

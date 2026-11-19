"use client";

import { useState } from "react";
import { Backpack, Utensils, Plus, Trash2, CheckSquare, Square } from "lucide-react";
import type { BelongingRow, DayRow, DishIngredientRow, DishRow, ParticipantRow } from "@/lib/model/types";

interface PrepAndDishesPanelProps {
  belongings: BelongingRow[];
  dishes: DishRow[];
  participants: ParticipantRow[];
  days: DayRow[];
  onUpsertBelonging: (b: BelongingRow) => Promise<void>;
  onDeleteBelonging: (id: string) => Promise<void>;
  onUpsertDish: (d: DishRow) => Promise<void>;
  onDeleteDish: (id: string) => Promise<void>;
}

const inputCls =
  "w-full min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-white/85 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";
const smallInputCls =
  "w-full min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-border)]";

export default function PrepAndDishesPanel({
  belongings,
  dishes,
  participants,
  days,
  onUpsertBelonging,
  onDeleteBelonging,
  onUpsertDish,
  onDeleteDish,
}: PrepAndDishesPanelProps) {
  // 持ち物フォーム
  const [bName, setBName] = useState("");
  const [bNeeded, setBNeeded] = useState(true);
  const [bAssigneeId, setBAssigneeId] = useState<string>("");
  const [bNote, setBNote] = useState("");

  // 料理フォーム
  const [dName, setDName] = useState("");
  const [dStatus, setDStatus] = useState<DishRow["status"]>("decided");
  const [dDayIndex, setDDayIndex] = useState<string>("1");
  const [dIngredients, setDIngredients] = useState<DishIngredientRow[]>([
    { name: "", quantity: 1, unit: "袋", ingredient_name: "" },
  ]);

  async function handleAddBelonging(e: React.FormEvent) {
    e.preventDefault();
    if (!bName.trim()) return;
    const p = participants.find((x) => x.id === bAssigneeId);
    await onUpsertBelonging({
      id: crypto.randomUUID(),
      name: bName.trim(),
      is_needed: bNeeded,
      is_prepared: false,
      assignee_participant_id: p?.id ?? null,
      assignee_full_name: p?.full_name ?? null,
      note: bNote.trim(),
      sort_order: belongings.length,
    });
    setBName("");
    setBNote("");
  }

  async function handleAddDish(e: React.FormEvent) {
    e.preventDefault();
    if (!dName.trim()) return;
    const validIngs = dIngredients
      .filter((ing) => ing.name.trim() || ing.ingredient_name.trim())
      .map((ing) => ({
        name: ing.name.trim() || ing.ingredient_name.trim(),
        quantity: ing.quantity,
        unit: ing.unit.trim(),
        ingredient_name: ing.ingredient_name.trim() || ing.name.trim(),
      }));
    await onUpsertDish({
      id: crypto.randomUUID(),
      name: dName.trim(),
      status: dStatus,
      related_day_index: dDayIndex === "" ? null : Number(dDayIndex),
      ingredients: validIngs,
      sort_order: dishes.length,
    });
    setDName("");
    setDIngredients([{ name: "", quantity: 1, unit: "袋", ingredient_name: "" }]);
  }

  return (
    <div className="space-y-6">
      {/* 1. 持ち物（belongings） */}
      <section className="space-y-3">
        <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
          <Backpack className="w-4 h-4 text-[var(--theme-accent-text)]" />
          <span>持ち物チェックリスト</span>
        </h3>

        <form onSubmit={handleAddBelonging} className="liquid-glass rounded-3xl p-3.5 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
            <div className="sm:col-span-4 min-w-0">
              <input
                type="text"
                required
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                placeholder="持ち物名（例: 薪 / シュラフ）*"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-3 min-w-0">
              <select
                value={bAssigneeId}
                onChange={(e) => setBAssigneeId(e.target.value)}
                className={inputCls}
              >
                <option value="">担当者なし</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}（{p.nickname}）
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3 min-w-0">
              <input
                type="text"
                value={bNote}
                onChange={(e) => setBNote(e.target.value)}
                placeholder="メモ（任意）"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={bNeeded}
                  onChange={(e) => setBNeeded(e.target.checked)}
                  className="accent-[var(--theme-accent)]"
                />
                必要
              </label>
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl liquid-btn-primary text-white text-xs font-bold shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                追加
              </button>
            </div>
          </div>
        </form>

        <div className="space-y-1.5">
          {belongings.map((b) => (
            <div
              key={b.id}
              className="liquid-glass rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2.5 flex-wrap min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onUpsertBelonging({ ...b, is_prepared: !b.is_prepared })}
                  className="text-[var(--theme-accent-text)] shrink-0"
                  title="準備済み切替"
                >
                  {b.is_prepared ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                <span
                  className={`text-xs font-bold break-words min-w-0 ${
                    b.is_prepared ? "line-through text-slate-400" : "text-slate-900"
                  }`}
                >
                  {b.name}
                </span>
                <button
                  type="button"
                  onClick={() => onUpsertBelonging({ ...b, is_needed: !b.is_needed })}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                    b.is_needed
                      ? "bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {b.is_needed ? "必要" : "不要"}
                </button>
                {b.assignee_full_name && (
                  <span className="text-[11px] text-slate-500 shrink-0">担当: {b.assignee_full_name}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDeleteBelonging(b.id)}
                className="p-1 text-slate-400 hover:text-red-600 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 2. 料理＋材料（dishes & ingredients） */}
      <section className="space-y-3">
        <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
          <Utensils className="w-4 h-4 text-[var(--theme-accent-text)]" />
          <span>料理・材料リスト</span>
        </h3>

        <form onSubmit={handleAddDish} className="liquid-glass rounded-3xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div className="sm:col-span-6 min-w-0">
              <input
                type="text"
                required
                value={dName}
                onChange={(e) => setDName(e.target.value)}
                placeholder="料理名（例: 坦々餃子鍋）*"
                className={`${inputCls} font-bold`}
              />
            </div>
            <div className="sm:col-span-3 min-w-0">
              <select
                value={dStatus}
                onChange={(e) => setDStatus(e.target.value as DishRow["status"])}
                className={inputCls}
              >
                <option value="decided">決まった (decided)</option>
                <option value="candidate">候補 (candidate)</option>
              </select>
            </div>
            <div className="sm:col-span-3 min-w-0">
              <select
                value={dDayIndex}
                onChange={(e) => setDDayIndex(e.target.value)}
                className={inputCls}
              >
                <option value="">日程指定なし</option>
                {days.map((d) => (
                  <option key={d.day_index} value={d.day_index}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--theme-accent-soft)] border border-[var(--theme-accent-border)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-[var(--theme-accent-text)]">
                材料（材料名・分量・単位・食材名）
              </span>
              <button
                type="button"
                onClick={() =>
                  setDIngredients((prev) => [
                    ...prev,
                    { name: "", quantity: 1, unit: "個", ingredient_name: "" },
                  ])
                }
                className="text-[11px] font-bold text-[var(--theme-accent-text)] hover:underline whitespace-nowrap"
              >
                ＋材料行を追加
              </button>
            </div>

            {dIngredients.map((ing, idx) => (
              <div
                key={idx}
                className="space-y-1.5 sm:space-y-0 sm:grid sm:grid-cols-12 sm:gap-1.5 sm:items-center rounded-xl bg-white/70 sm:bg-transparent p-2 sm:p-0 border border-white sm:border-0"
              >
                {/* スマホ: 1段目に材料表示名＋削除、PC: col-span-4 */}
                <div className="flex items-center gap-1.5 sm:contents">
                  <div className="flex-1 min-w-0 sm:col-span-4">
                    <input
                      type="text"
                      value={ing.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDIngredients((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? { ...x, name: val, ingredient_name: x.ingredient_name || val }
                              : x,
                          ),
                        );
                      }}
                      placeholder="材料表示名(例:餃子)"
                      className={smallInputCls}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDIngredients((prev) => prev.filter((_, i) => i !== idx))}
                    className="sm:hidden p-1 text-slate-400 hover:text-red-600 shrink-0"
                    title="行を削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* スマホ: 2段目に分量・単位・食材DB名、PC: col-span-2 / 2 / 3 / 1 */}
                <div className="grid grid-cols-12 gap-1.5 sm:contents">
                  <div className="col-span-3 sm:col-span-2 min-w-0">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={ing.quantity ?? ""}
                      onChange={(e) =>
                        setDIngredients((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? { ...x, quantity: e.target.value === "" ? null : Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                      placeholder="分量"
                      className={`${smallInputCls} font-mono`}
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2 min-w-0">
                    <input
                      type="text"
                      value={ing.unit}
                      onChange={(e) =>
                        setDIngredients((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)),
                        )
                      }
                      placeholder="単位"
                      className={smallInputCls}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3 min-w-0">
                    <input
                      type="text"
                      value={ing.ingredient_name}
                      onChange={(e) =>
                        setDIngredients((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, ingredient_name: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="食材名(例:豚ひき肉)"
                      className={smallInputCls}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setDIngredients((prev) => prev.filter((_, i) => i !== idx))}
                  className="hidden sm:flex sm:col-span-1 text-slate-400 hover:text-red-600 justify-center"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl liquid-btn-primary text-white text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" />
              料理を追加
            </button>
          </div>
        </form>

        <div className="space-y-2">
          {dishes.map((d) => (
            <div
              key={d.id}
              className="liquid-glass rounded-2xl p-3.5 flex items-start justify-between gap-2"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold text-white shrink-0 ${
                      d.status === "decided" ? "bg-[var(--theme-accent)]" : "bg-amber-600"
                    }`}
                  >
                    {d.status === "decided" ? "決まった" : "候補"}
                  </span>
                  <span className="text-sm font-extrabold text-slate-900 break-words">{d.name}</span>
                  {d.related_day_index !== null && (
                    <span className="text-xs text-slate-500">Day {d.related_day_index}</span>
                  )}
                </div>
                <div className="text-xs text-slate-600 flex flex-wrap gap-1.5">
                  {d.ingredients.map((ing, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-lg bg-white/80 border border-slate-200 text-slate-700 text-[11px]"
                    >
                      {ing.name} {ing.quantity ?? "?"}
                      {ing.unit}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDeleteDish(d.id)}
                className="p-1 text-slate-400 hover:text-red-600 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";
import { X, Calculator, Star, Link2, Sparkles, Clock } from "lucide-react";
import type { SpotRow } from "@/lib/model/types";
import { combineDateTime, toTokyoDate, toTokyoHHMM } from "@/lib/datetime";
import { addDays } from "@/lib/model/types";
import { getRouteProvider, type LatLng } from "@/lib/routing";
import {
  dayNumberToJa,
  deserializeBusinessHours,
  serializeBusinessHours,
  type BusinessHoursRule,
} from "@/lib/geo/business-hours";

interface SpotEditorModalProps {
  dayIndex: number;
  dayDate: string | null;
  prevCoords: LatLng | null;
  initial: SpotRow;
  isNew: boolean;
  onSave: (spot: SpotRow) => Promise<void> | void;
  onDelete?: (spotId: string) => Promise<void> | void;
  onClose: () => void;
}

const CATEGORIES: { value: SpotRow["category"]; label: string }[] = [
  { value: "sightseeing", label: "観光" },
  { value: "meal", label: "食事" },
  { value: "lodging", label: "宿泊" },
  { value: "transport", label: "移動" },
  { value: "shopping", label: "買い物" },
  { value: "other", label: "その他" },
];

const STATUSES: { value: SpotRow["status"]; label: string; desc: string }[] = [
  { value: "decided", label: "決まった", desc: "確定した目的地" },
  { value: "candidate", label: "候補", desc: "検討中の候補" },
  { value: "undecided", label: "未定", desc: "まだ未定" },
];

const MODES: { value: NonNullable<SpotRow["transport_mode"]>; label: string }[] = [
  { value: "car", label: "車" },
  { value: "walk", label: "徒歩" },
  { value: "train", label: "電車/バス" },
  { value: "manual", label: "手動入力" },
];

export default function SpotEditorModal({
  dayDate,
  prevCoords,
  initial,
  isNew,
  onSave,
  onDelete,
  onClose,
}: SpotEditorModalProps) {
  const todayStr = toTokyoDate(new Date());
  const baseDefaultDate = dayDate ?? todayStr;
  const [spot, setSpot] = useState<SpotRow>(initial);
  const [gmapUrl, setGmapUrl] = useState(initial.place_url ?? "");
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const [bhRule, setBhRule] = useState<BusinessHoursRule>(() =>
    deserializeBusinessHours(initial.transport_note),
  );

  const [resTimeHHMM, setResTimeHHMM] = useState<string>(
    initial.reservation_time ? toTokyoHHMM(initial.reservation_time) : "12:00",
  );
  const [checkInDate, setCheckInDate] = useState<string>(
    initial.check_in ? toTokyoDate(new Date(initial.check_in)) : baseDefaultDate,
  );
  const [checkInHHMM, setCheckInHHMM] = useState<string>(
    initial.check_in ? toTokyoHHMM(initial.check_in) : "15:00",
  );
  const [checkOutDate, setCheckOutDate] = useState<string>(
    initial.check_out
      ? toTokyoDate(new Date(initial.check_out))
      : addDays(baseDefaultDate, 1),
  );
  const [checkOutHHMM, setCheckOutHHMM] = useState<string>(
    initial.check_out ? toTokyoHHMM(initial.check_out) : "10:00",
  );
  const [hasCheckInOut, setHasCheckInOut] = useState<boolean>(
    initial.category === "lodging" || initial.check_in !== null || initial.check_out !== null,
  );
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canAutoRoute =
    prevCoords !== null &&
    spot.lat !== null &&
    spot.lng !== null &&
    (spot.transport_mode === "car" || spot.transport_mode === "walk");

  async function handleResolveGoogleMapUrl() {
    if (!gmapUrl.trim()) return;
    setResolvingUrl(true);
    setResolveMsg(null);
    try {
      const res = await fetch("/api/places/resolve-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gmapUrl.trim() }),
      });
      const data = (await res.json()) as {
        name?: string;
        address?: string | null;
        lat?: number | null;
        lng?: number | null;
        place_url?: string;
        business_hours?: BusinessHoursRule;
        error?: string;
      };
      if (!res.ok) {
        setResolveMsg(data.error ?? "リンクの解析に失敗しました");
        return;
      }

      setSpot((prev) => ({
        ...prev,
        name: data.name || prev.name,
        address: data.address ?? prev.address,
        lat: data.lat ?? prev.lat,
        lng: data.lng ?? prev.lng,
        place_url: data.place_url ?? gmapUrl.trim(),
      }));

      if (data.business_hours) {
        setBhRule(data.business_hours);
      }

      // 座標が取れたら前の地点からの移動時間も自動算出を試みる
      if (
        prevCoords &&
        data.lat !== null &&
        data.lat !== undefined &&
        data.lng !== null &&
        data.lng !== undefined &&
        (spot.transport_mode === "car" || spot.transport_mode === "walk")
      ) {
        try {
          const r = await getRouteProvider().route(
            prevCoords,
            { lat: data.lat, lng: data.lng },
            spot.transport_mode,
          );
          setSpot((prev) => ({
            ...prev,
            transport_duration_minutes: r.duration_minutes,
            transport_distance_m: r.distance_m,
          }));
        } catch {
          // ignore
        }
      }

      const hasHours =
        data.business_hours?.open ||
        (data.business_hours?.closedDays && data.business_hours.closedDays.length > 0);
      setResolveMsg(
        hasHours
          ? "✅ 場所情報と営業時間・定休日を自動取得しました！"
          : "✅ 場所情報を取得しました（営業時間データがない場合は下で設定できます）",
      );
    } catch {
      setResolveMsg("通信エラーが発生しました");
    } finally {
      setResolvingUrl(false);
    }
  }

  async function handleAutoRoute(modeOverride?: "car" | "walk") {
    const mode = modeOverride ?? (spot.transport_mode === "walk" ? "walk" : "car");
    if (!prevCoords || spot.lat === null || spot.lng === null) return;
    setCalcBusy(true);
    setCalcErr(null);
    try {
      const r = await getRouteProvider().route(prevCoords, { lat: spot.lat, lng: spot.lng }, mode);
      setSpot((prev) => ({
        ...prev,
        transport_mode: mode,
        transport_duration_minutes: r.duration_minutes,
        transport_distance_m: r.distance_m,
      }));
    } catch (e) {
      setCalcErr(e instanceof Error ? e.message : "ルート計算に失敗しました");
    } finally {
      setCalcBusy(false);
    }
  }

  function toggleClosedDay(dow: number) {
    setBhRule((prev) => {
      const exists = prev.closedDays.includes(dow);
      const next = exists
        ? prev.closedDays.filter((d) => d !== dow)
        : [...prev.closedDays, dow].sort();
      return { ...prev, closedDays: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!spot.name.trim()) return;
    setSaving(true);
    try {
      const baseDate = dayDate ?? todayStr;
      const reservation_time =
        spot.is_fixed && resTimeHHMM ? combineDateTime(baseDate, resTimeHHMM) : null;
      const check_in =
        spot.category === "lodging" && hasCheckInOut && checkInDate && checkInHHMM
          ? combineDateTime(checkInDate, checkInHHMM)
          : null;
      const check_out =
        spot.category === "lodging" && hasCheckInOut && checkOutDate && checkOutHHMM
          ? combineDateTime(checkOutDate, checkOutHHMM)
          : null;

      await onSave({
        ...spot,
        name: spot.name.trim(),
        place_url: gmapUrl.trim() ? gmapUrl.trim() : spot.place_url,
        transport_note: serializeBusinessHours(bhRule),
        reservation_time,
        check_in,
        check_out,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white text-neutral-900 w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <h2 className="text-base font-bold">{isNew ? "スポットを追加" : "スポットを編集"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-4 space-y-4 text-sm">
          {/* Google マップ URL 貼り付け自動入力ボックス */}
          <div className="rounded-2xl bg-blue-50/70 border border-blue-200 p-3 space-y-2">
            <label className="text-xs font-extrabold text-blue-950 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Google マップの共有リンクを貼り付けて自動入力</span>
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={gmapUrl}
                onChange={(e) => setGmapUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/... または GoogleマップURL"
                className="flex-1 px-3 py-1.5 rounded-xl border border-blue-200 bg-white text-xs"
              />
              <button
                type="button"
                disabled={resolvingUrl || !gmapUrl.trim()}
                onClick={handleResolveGoogleMapUrl}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{resolvingUrl ? "解析中..." : "自動取得"}</span>
              </button>
            </div>
            {resolveMsg && (
              <p className="text-[11px] font-semibold text-blue-900">{resolveMsg}</p>
            )}
          </div>

          {/* スポット名 + メイン目的地フラグ */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-700">スポット名 *</label>
              <button
                type="button"
                onClick={() => setSpot((s) => ({ ...s, is_main: !s.is_main }))}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                  spot.is_main
                    ? "bg-amber-50 border-amber-400 text-amber-800"
                    : "bg-neutral-50 border-neutral-200 text-neutral-500"
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${spot.is_main ? "fill-amber-400 text-amber-500" : ""}`} />
                メイン目的地
              </button>
            </div>
            <input
              type="text"
              required
              value={spot.name}
              onChange={(e) => setSpot((s) => ({ ...s, name: e.target.value }))}
              placeholder="例: 目的地・お店の名前"
              className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 状態（決まった / 候補 / 未定）: 第2章・第5.3章の必須構造化項目 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-700">
              決定ステータス（Notion連携用）
            </label>
            <div className="grid grid-cols-3 gap-2">
              {STATUSES.map((st) => {
                const active = spot.status === st.value;
                return (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => setSpot((s) => ({ ...s, status: st.value }))}
                    className={`py-2 px-2 rounded-xl border text-center transition ${
                      active
                        ? st.value === "decided"
                          ? "bg-emerald-600 text-white border-emerald-600 font-bold"
                          : st.value === "candidate"
                            ? "bg-amber-500 text-white border-amber-500 font-bold"
                            : "bg-neutral-700 text-white border-neutral-700 font-bold"
                        : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
                    }`}
                  >
                    <div className="text-xs">{st.label}</div>
                    <div className={`text-[10px] ${active ? "text-white/85" : "text-neutral-400"}`}>
                      {st.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* カテゴリ */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-700">カテゴリ</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setSpot((s) => ({ ...s, category: c.value }));
                    if (c.value === "lodging") setHasCheckInOut(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border ${
                    spot.category === c.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* 住所 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-700">
              {spot.category === "lodging" ? "宿泊地住所 *" : "住所（任意）"}
            </label>
            <input
              type="text"
              value={spot.address ?? ""}
              onChange={(e) => setSpot((s) => ({ ...s, address: e.target.value || null }))}
              placeholder="例: 宿泊先や目的地の住所"
              className="w-full px-3 py-2 rounded-xl border border-neutral-300"
            />
          </div>

          {/* 宿泊スポット専用: チェックイン・チェックアウト */}
          {spot.category === "lodging" && (
            <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-900">宿泊チェックイン・アウト</span>
                <label className="inline-flex items-center gap-1.5 text-xs text-purple-800">
                  <input
                    type="checkbox"
                    checked={hasCheckInOut}
                    onChange={(e) => setHasCheckInOut(e.target.checked)}
                  />
                  時刻を指定する
                </label>
              </div>
              {hasCheckInOut && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-purple-800 mb-1">
                      チェックイン
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="date"
                        value={checkInDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCheckInDate(val);
                          if (val && (!checkOutDate || checkOutDate < val)) {
                            setCheckOutDate(addDays(val, 1));
                          }
                        }}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-purple-200 bg-white text-xs"
                      />
                      <input
                        type="time"
                        value={checkInHHMM}
                        onChange={(e) => setCheckInHHMM(e.target.value)}
                        className="w-24 px-2 py-1.5 rounded-lg border border-purple-200 bg-white text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-purple-800 mb-1">
                      チェックアウト
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="date"
                        min={checkInDate || undefined}
                        value={checkOutDate}
                        onChange={(e) => setCheckOutDate(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-lg border border-purple-200 bg-white text-xs"
                      />
                      <input
                        type="time"
                        value={checkOutHHMM}
                        onChange={(e) => setCheckOutHHMM(e.target.value)}
                        className="w-24 px-2 py-1.5 rounded-lg border border-purple-200 bg-white text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 営業時間・定休日（自動取得＋手動調整、予定時刻が範囲外ならアラート表示） */}
          {spot.category !== "lodging" && (
            <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-3 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-bold text-amber-950 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>営業時間・定休日（予定と照合して時間外・休業日アラートを表示）</span>
                </span>
                {bhRule.rawText && (
                  <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-amber-200 text-amber-800">
                    自動取得: {bhRule.rawText}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-amber-900 mb-0.5">開店時刻</label>
                  <input
                    type="time"
                    value={bhRule.open ?? ""}
                    onChange={(e) =>
                      setBhRule((prev) => ({ ...prev, open: e.target.value || null }))
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-amber-200 bg-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-amber-900 mb-0.5">閉店時刻</label>
                  <input
                    type="time"
                    value={bhRule.close ?? ""}
                    onChange={(e) =>
                      setBhRule((prev) => ({ ...prev, close: e.target.value || null }))
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-amber-200 bg-white text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-amber-900 mb-1">定休日（タップで選択）</label>
                <div className="grid grid-cols-7 gap-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                    const isClosed = bhRule.closedDays.includes(dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => toggleClosedDay(dow)}
                        className={`py-1 rounded-lg text-xs font-bold border transition ${
                          isClosed
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-slate-600 border-amber-200 hover:bg-amber-100/50"
                        }`}
                      >
                        {dayNumberToJa(dow)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 前の地点からの移動手段・移動時間 */}
          <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800">前の地点からの移動</span>
              {canAutoRoute && (
                <button
                  type="button"
                  disabled={calcBusy}
                  onClick={() => handleAutoRoute()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  {calcBusy ? "計算中..." : "OSRMで自動計算"}
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    setSpot((s) => ({ ...s, transport_mode: m.value }));
                    if ((m.value === "car" || m.value === "walk") && prevCoords && spot.lat !== null && spot.lng !== null) {
                      void handleAutoRoute(m.value);
                    }
                  }}
                  className={`py-1.5 rounded-lg text-xs font-medium border ${
                    spot.transport_mode === m.value
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-700 border-neutral-200"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-neutral-600 mb-1">移動時間（分）</label>
                <input
                  type="number"
                  min={0}
                  value={spot.transport_duration_minutes ?? ""}
                  onChange={(e) =>
                    setSpot((s) => ({
                      ...s,
                      transport_duration_minutes: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                    }))
                  }
                  placeholder="例: 30"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-600 mb-1">距離（m・任意）</label>
                <input
                  type="number"
                  min={0}
                  value={spot.transport_distance_m ?? ""}
                  onChange={(e) =>
                    setSpot((s) => ({
                      ...s,
                      transport_distance_m: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                    }))
                  }
                  placeholder="自動算出"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs"
                />
              </div>
            </div>
            {calcErr && <p className="text-xs text-red-600">{calcErr}</p>}
          </div>

          {/* 滞在時間 & 予約時間（固定フラグ） */}
          {/* 宿泊でチェックイン・チェックアウト時間を指定している場合は滞在時間・予約時刻の設定は不要 */}
          {!(spot.category === "lodging" && hasCheckInOut) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  滞在時間（分）
                </label>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={spot.stay_minutes}
                  onChange={(e) =>
                    setSpot((s) => ({
                      ...s,
                      stay_minutes: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-neutral-700">予約時刻（固定）</label>
                  <label className="inline-flex items-center gap-1 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={spot.is_fixed}
                      onChange={(e) => setSpot((s) => ({ ...s, is_fixed: e.target.checked }))}
                    />
                    予約あり
                  </label>
                </div>
                <input
                  type="time"
                  disabled={!spot.is_fixed}
                  value={resTimeHHMM}
                  onChange={(e) => setResTimeHHMM(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-neutral-300 disabled:bg-neutral-100 disabled:text-neutral-400"
                />
              </div>
            </div>
          )}

          {/* メモ */}
          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">メモ</label>
            <textarea
              rows={2}
              value={spot.memo}
              onChange={(e) => setSpot((s) => ({ ...s, memo: e.target.value }))}
              placeholder="補足メモ（決定状態やメインフラグは上の専用ボタンで選択してください）"
              className="w-full px-3 py-2 rounded-xl border border-neutral-300"
            />
          </div>

          {/* アクション */}
          <div className="flex items-center justify-between pt-2 border-t border-neutral-200 gap-2">
            {!isNew && onDelete ? (
              <button
                type="button"
                onClick={async () => {
                  await onDelete(spot.id);
                  onClose();
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                削除する
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

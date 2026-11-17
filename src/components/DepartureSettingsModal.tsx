"use client";

import { useState } from "react";
import { X, Navigation, Search, MapPin, Calculator, Check, Link2 } from "lucide-react";
import type { DayRow, SpotRow } from "@/lib/model/types";
import { searchPlaces, type GeocodeResult } from "@/lib/geo/geocode";
import { toTokyoHHMM } from "@/lib/datetime";
import TimeSelect from "./TimeSelect";

interface DepartureSettingsModalProps {
  day: DayRow;
  daySpotsCount: number;
  checkoutSpot: SpotRow | null;
  recalcBusy: boolean;
  onSaveDay: (patch: Partial<DayRow>) => Promise<void>;
  onRecalcRoutes: (overrideDay?: DayRow) => Promise<void>;
  onClose: () => void;
}

export default function DepartureSettingsModal({
  day,
  daySpotsCount,
  checkoutSpot,
  recalcBusy,
  onSaveDay,
  onRecalcRoutes,
  onClose,
}: DepartureSettingsModalProps) {
  const [date, setDate] = useState<string>(day.date ?? "");
  const [depTime, setDepTime] = useState<string | null>(
    day.departure_time ?? (checkoutSpot?.check_out ? toTokyoHHMM(checkoutSpot.check_out) : null),
  );
  const [point, setPoint] = useState<string>(day.departure_point ?? checkoutSpot?.name ?? "");
  const [lat, setLat] = useState<number | null>(day.departure_lat ?? checkoutSpot?.lat ?? null);
  const [lng, setLng] = useState<number | null>(day.departure_lng ?? checkoutSpot?.lng ?? null);

  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<GeocodeResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSearchLocation() {
    const q = point.trim();
    if (!q) {
      setSearchErr("駅名・場所名、またはGoogleマップのURLを入力してください");
      return;
    }
    setSearching(true);
    setSearchErr(null);
    setStatusMsg(null);
    setCandidates([]);

    try {
      // Googleマップ等のURLが貼られた場合は /api/places/resolve-url で展開
      if (/https?:\/\//i.test(q)) {
        const res = await fetch("/api/places/resolve-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: q }),
        });
        const data = (await res.json()) as {
          name?: string;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          error?: string;
        };
        if (!res.ok || data.lat == null || data.lng == null) {
          setSearchErr(data.error ?? "URLから座標を取得できませんでした");
          return;
        }
        setPoint(data.name || q);
        setLat(data.lat);
        setLng(data.lng);
        setStatusMsg(`✅ 「${data.name}」の座標を設定しました`);
        return;
      }

      // 地名・駅名検索（複数候補がある場合は必ず一覧を出してユーザーに選んでもらう）
      const results = await searchPlaces(q);
      if (results.length === 0) {
        setSearchErr(`「${q}」が見つかりませんでした。都道府県や市区町村も入れてみてください（例: 長野市 長沼駅）`);
        return;
      }
      if (results.length === 1) {
        const only = results[0];
        setPoint(only.name);
        setLat(only.lat);
        setLng(only.lng);
        setStatusMsg(`✅ 「${only.name}」（${only.address}）を設定しました`);
      } else {
        setCandidates(results);
      }
    } catch {
      setSearchErr("検索中に通信エラーが発生しました。もう一度お試しください");
    } finally {
      setSearching(false);
    }
  }

  function handleSelectCandidate(c: GeocodeResult) {
    setPoint(c.name);
    setLat(c.lat);
    setLng(c.lng);
    setCandidates([]);
    setSearchErr(null);
    setStatusMsg(`✅ 「${c.name}」（${c.address}）を選択しました`);
  }

  async function handleSaveAndClose() {
    setSaving(true);
    try {
      const patch: Partial<DayRow> = {
        date: date || null,
        departure_time: depTime,
        departure_point: point.trim() || null,
        departure_lat: lat,
        departure_lng: lng,
      };
      await onSaveDay(patch);
      if (lat !== null && lng !== null && daySpotsCount > 0) {
        await onRecalcRoutes({ ...day, ...patch });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2300] bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white text-slate-900 w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold">{day.label} の出発設定</h2>
              {checkoutSpot ? (
                <p className="text-[11px] text-purple-700 font-semibold">
                  🏨 宿泊地「{checkoutSpot.name}」と自動連動中
                </p>
              ) : (
                <p className="text-[11px] text-slate-500">
                  出発時刻と場所を設定すると自動で移動時間を計算します
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3.5 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">日付</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">出発時刻</label>
              <TimeSelect
                value={depTime}
                defaultHour="08"
                onChange={setDepTime}
                className="w-full justify-between"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              出発地点（駅名・住所 または GoogleマップURL）
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={point}
                onChange={(e) => {
                  setPoint(e.target.value);
                  setStatusMsg(null);
                  setSearchErr(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSearchLocation();
                  }
                }}
                placeholder="例: 長野市 長沼駅 / GoogleマップURL"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
              <button
                type="button"
                disabled={searching}
                onClick={handleSearchLocation}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{searching ? "検索中..." : "場所を検索"}</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              <Link2 className="w-3 h-3 shrink-0 text-slate-400" />
              <span>同名駅（例: 長沼駅）は都道府県・市区町村を混ぜるか候補から選べます</span>
            </p>

            {/* 複数候補が見つかった場合の選択リスト */}
            {candidates.length > 0 && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 divide-y divide-emerald-100 max-h-48 overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] font-bold text-emerald-900 bg-emerald-50">
                  候補が {candidates.length} 件見つかりました。正しい場所を選んでください：
                </div>
                {candidates.map((c, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectCandidate(c)}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-100/60 flex items-start gap-2 transition"
                  >
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900">{c.name}</div>
                      <div className="text-[11px] text-slate-600 leading-snug">{c.address}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchErr && (
              <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {searchErr}
              </p>
            )}

            {statusMsg && (
              <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                {statusMsg}
              </p>
            )}

            {lat !== null && lng !== null && !statusMsg && (
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  座標設定済み ({lat.toFixed(4)}, {lng.toFixed(4)})
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
          {daySpotsCount > 0 ? (
            <button
              type="button"
              disabled={recalcBusy}
              onClick={() =>
                onRecalcRoutes({
                  ...day,
                  date: date || null,
                  departure_time: depTime,
                  departure_point: point.trim() || null,
                  departure_lat: lat,
                  departure_lng: lng,
                })
              }
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 disabled:opacity-50"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>{recalcBusy ? "計算中..." : "移動時間を再計算"}</span>
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveAndClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存して閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}

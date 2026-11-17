"use client";

import { useState } from "react";
import { X, Calculator, ArrowRight, ExternalLink, Navigation } from "lucide-react";
import type { SpotRow } from "@/lib/model/types";
import { getRouteProvider, type LatLng } from "@/lib/routing";
import { geocodeSpot } from "@/lib/geo/geocode";
import { deserializeBusinessHours, serializeBusinessHours } from "@/lib/geo/business-hours";

interface LegEditorModalProps {
  fromLabel: string;
  fromCoords: LatLng | null;
  toSpot: SpotRow;
  routeFromKey: string;
  onClose: () => void;
  onSave: (updatedSpot: SpotRow) => Promise<void> | void;
}

const MODES: { value: NonNullable<SpotRow["transport_mode"]>; label: string }[] = [
  { value: "car", label: "車" },
  { value: "walk", label: "徒歩" },
  { value: "train", label: "電車" },
  { value: "manual", label: "手動入力" },
];

export default function LegEditorModal({
  fromLabel,
  fromCoords,
  toSpot,
  routeFromKey,
  onClose,
  onSave,
}: LegEditorModalProps) {
  const initialBh = deserializeBusinessHours(toSpot.transport_note);
  const [mode, setMode] = useState<NonNullable<SpotRow["transport_mode"]>>(
    toSpot.transport_mode ?? "car",
  );
  const [avoidTolls, setAvoidTolls] = useState<boolean>(Boolean(initialBh.avoidTolls));
  const [durationMin, setDurationMin] = useState<number | null>(toSpot.transport_duration_minutes);
  const [distanceKmStr, setDistanceKmStr] = useState<string>(
    toSpot.transport_distance_m !== null ? (toSpot.transport_distance_m / 1000).toFixed(1) : "",
  );
  const [toCoords, setToCoords] = useState<LatLng | null>(
    toSpot.lat !== null && toSpot.lng !== null ? { lat: toSpot.lat, lng: toSpot.lng } : null,
  );
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canAutoRoute =
    fromCoords !== null &&
    (toCoords !== null || Boolean(toSpot.address?.trim() || toSpot.name.trim())) &&
    (mode === "car" || mode === "walk" || mode === "train");

  async function runAutoRoute(
    nextMode: NonNullable<SpotRow["transport_mode"]> = mode,
    nextAvoidTolls: boolean = avoidTolls,
  ) {
    if (!fromCoords) {
      setCalcErr("出発側の座標が未設定のため計算できません");
      return;
    }
    if (nextMode !== "car" && nextMode !== "walk" && nextMode !== "train") return;
    setCalcBusy(true);
    setCalcErr(null);
    try {
      let target = toCoords;
      if (!target) {
        const geo = await geocodeSpot(toSpot.address, toSpot.name);
        if (!geo) {
          setCalcErr("到着側の座標を取得できませんでした。場所の住所を確認してください。");
          return;
        }
        target = { lat: geo.lat, lng: geo.lng };
        setToCoords(target);
      }
      const r = await getRouteProvider().route(fromCoords, target, nextMode, {
        avoidTolls: nextMode === "car" && nextAvoidTolls,
      });
      setDurationMin(r.duration_minutes);
      setDistanceKmStr((r.distance_m / 1000).toFixed(1));
    } catch (e) {
      setCalcErr(e instanceof Error ? e.message : "ルート計算に失敗しました");
    } finally {
      setCalcBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const nextNote = serializeBusinessHours({
        ...initialBh,
        avoidTolls: mode === "car" ? avoidTolls : false,
        routeFromKey,
      });
      const parsedKm = Number(distanceKmStr);
      const finalDistanceM =
        distanceKmStr.trim() === "" || !Number.isFinite(parsedKm)
          ? null
          : Math.max(0, Math.round(parsedKm * 1000));
      await onSave({
        ...toSpot,
        lat: toCoords?.lat ?? toSpot.lat,
        lng: toCoords?.lng ?? toSpot.lng,
        transport_mode: mode,
        transport_duration_minutes: durationMin,
        transport_distance_m: finalDistanceM,
        transport_note: nextNote,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const gmapHref =
    fromCoords && toCoords
      ? `https://www.google.com/maps/dir/?api=1&origin=${fromCoords.lat},${fromCoords.lng}&destination=${toCoords.lat},${toCoords.lng}&travelmode=${
          mode === "walk" ? "walking" : mode === "train" ? "transit" : "driving"
        }${mode === "car" && avoidTolls ? "&dir_action=navigate&avoid=tolls,highways" : ""}`
      : null;

  return (
    <div className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white text-neutral-900 w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <h2 className="text-base font-bold flex items-center gap-1.5">
            <Navigation className="w-4 h-4 text-blue-600" />
            <span>移動区間の編集</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-sm">
          {/* 出発 → 到着 の明示 */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 flex items-center gap-2 text-xs font-bold text-slate-800">
            <span className="truncate max-w-[42%] text-emerald-700">{fromLabel}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate max-w-[48%] text-blue-700">{toSpot.name}</span>
          </div>

          {/* 移動手段 */}
          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1.5">移動手段</label>
            <div className="grid grid-cols-4 gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    setMode(m.value);
                    if (
                      (m.value === "car" || m.value === "walk" || m.value === "train") &&
                      fromCoords
                    ) {
                      void runAutoRoute(m.value, avoidTolls);
                    }
                  }}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    mode === m.value
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 車移動時: 高速・有料道路を使う / 下道のみ */}
          {mode === "car" && (
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                高速・有料道路の設定
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setAvoidTolls(false);
                    if (fromCoords) void runAutoRoute("car", false);
                  }}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition ${
                    !avoidTolls
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                      : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  🛣️ 高速優先（有料道路可）
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAvoidTolls(true);
                    if (fromCoords) void runAutoRoute("car", true);
                  }}
                  className={`py-2 px-2 rounded-lg text-xs font-bold border transition ${
                    avoidTolls
                      ? "bg-amber-600 text-white border-amber-600 shadow-2xs"
                      : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  🚗 高速回避（下道のみ）
                </button>
              </div>
            </div>
          )}

          {/* 再計算ボタン & Googleマップ経路リンク */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {canAutoRoute ? (
              <button
                type="button"
                disabled={calcBusy}
                onClick={() => void runAutoRoute(mode, avoidTolls)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                <Calculator className="w-3.5 h-3.5" />
                {calcBusy ? "計算中..." : "前後地点から自動計算"}
              </button>
            ) : (
              <span className="text-[11px] text-neutral-500">
                ※ 座標未設定のため手動入力のみ
              </span>
            )}
            {gmapHref && (
              <a
                href={gmapHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-neutral-300 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
              >
                <span>Googleマップ</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* 所要時間・距離（手動調整も可） */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-neutral-600 mb-1">移動時間（分）</label>
              <input
                type="number"
                min={0}
                value={durationMin ?? ""}
                onChange={(e) =>
                  setDurationMin(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))
                }
                placeholder="自動算出"
                className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-600 mb-1">距離（km）</label>
              <input
                type="number"
                min={0}
                step="0.1"
                value={distanceKmStr}
                onChange={(e) => setDistanceKmStr(e.target.value)}
                placeholder="自動算出（例: 12.5）"
                className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs"
              />
            </div>
          </div>

          {calcErr && <p className="text-xs text-red-600">{calcErr}</p>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving || calcBusy}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "この区間の移動を保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

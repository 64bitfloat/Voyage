"use client";

import { useMemo, useState } from "react";
import {
  X,
  Star,
  Link2,
  Sparkles,
  Clock,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import type { DayRow, SpotRow } from "@/lib/model/types";
import { combineDateTime, toTokyoDate, toTokyoHHMM, toTokyoISO } from "@/lib/datetime";
import { addDays } from "@/lib/model/types";
import { getRouteProvider, type LatLng } from "@/lib/routing";
import { geocodeSpot } from "@/lib/geo/geocode";
import {
  buildDefaultSlotPresets,
  checkBusinessHoursAlert,
  checkLodgingPolicyAlert,
  dayNumberToJa,
  deserializeBusinessHours,
  serializeBusinessHours,
  type BusinessHoursRule,
  type ChoiceSlotTag,
} from "@/lib/geo/business-hours";
import { computeDaySchedule, spotsOfDay } from "@/lib/schedule/compute";
import TimeSelect from "./TimeSelect";

interface SpotEditorModalProps {
  days: DayRow[];
  allSpots: SpotRow[];
  checkoutByDay: Map<number, SpotRow | null>;
  initial: SpotRow;
  isNew: boolean;
  onSave: (spot: SpotRow) => Promise<void> | void;
  onDelete?: (spotId: string) => Promise<void> | void;
  onClose: () => void;
}

const CATEGORIES: { value: SpotRow["category"]; label: string }[] = [
  { value: "sightseeing", label: "観光" },
  { value: "onsen", label: "温泉" },
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

function addMinutesHHMM(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + mins) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export default function SpotEditorModal({
  days,
  allSpots,
  checkoutByDay,
  initial,
  isNew,
  onSave,
  onDelete,
  onClose,
}: SpotEditorModalProps) {
  const todayStr = toTokyoDate(new Date());
  const [spot, setSpot] = useState<SpotRow>(initial);
  const [gmapUrl, setGmapUrl] = useState(initial.place_url ?? "");
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const [bhRule, setBhRule] = useState<BusinessHoursRule>(() =>
    deserializeBusinessHours(initial.transport_note),
  );
  const [customSlotName, setCustomSlotName] = useState("");
  const [customSlotStart, setCustomSlotStart] = useState("12:00");
  const [customSlotEnd, setCustomSlotEnd] = useState("14:00");

  // 現在の旅行に含まれる全スポットから使われている枠タグ＋標準プリセット枠タグを統合
  const availableSlotPresets: ChoiceSlotTag[] = useMemo(() => {
    const dayNums = days.filter((d) => d.day_index >= 1).map((d) => d.day_index);
    const presets = buildDefaultSlotPresets(dayNums.length > 0 ? dayNums : [1, 2]);
    const map = new Map<string, ChoiceSlotTag>(presets.map((p) => [p.id, p]));
    for (const s of allSpots) {
      const b = deserializeBusinessHours(s.transport_note);
      for (const st of b.slotTags ?? []) {
        map.set(st.id, st);
      }
    }
    for (const st of bhRule.slotTags ?? []) {
      map.set(st.id, st);
    }
    return [...map.values()];
  }, [allSpots, bhRule.slotTags, days]);

  function toggleSlotTag(preset: ChoiceSlotTag) {
    setBhRule((prev) => {
      const current = prev.slotTags ?? [];
      const exists = current.some((x) => x.id === preset.id);
      const next = exists
        ? current.filter((x) => x.id !== preset.id)
        : [...current, preset];
      return { ...prev, slotTags: next };
    });
  }

  function updateSlotWindow(id: string, field: "windowStart" | "windowEnd", val: string) {
    setBhRule((prev) => ({
      ...prev,
      slotTags: (prev.slotTags ?? []).map((x) =>
        x.id === id ? { ...x, [field]: val } : x,
      ),
    }));
  }

  function handleAddCustomSlotTag() {
    const label = customSlotName.trim();
    if (!label) return;
    const dayMatch = label.match(/^(\d+)日目|^Day\s*(\d+)/i);
    const dayIdx = dayMatch ? Number(dayMatch[1] ?? dayMatch[2]) : null;
    const id = `custom-${label}`;
    const newTag: ChoiceSlotTag = {
      id,
      label,
      dayIndex: dayIdx,
      windowStart: customSlotStart || "12:00",
      windowEnd: customSlotEnd || "14:00",
    };
    setBhRule((prev) => {
      const current = prev.slotTags ?? [];
      if (current.some((x) => x.id === id)) return prev;
      return { ...prev, slotTags: [...current, newTag] };
    });
    setCustomSlotName("");
  }

  // 選択中の日程（Day 1 / Day 2...）
  const selectedDay: DayRow = useMemo(
    () =>
      days.find((d) => d.day_index === spot.day_index) ??
      days[0] ?? {
        day_index: 1,
        label: "Day 1",
        date: null,
        departure_point: null,
        departure_lat: null,
        departure_lng: null,
        departure_time: "08:00",
      },
    [days, spot.day_index],
  );
  const dayDate = selectedDay.date;
  const baseDefaultDate = dayDate ?? todayStr;

  // 行きたい時刻 / 予約時刻（HH:MM または null=未定）
  // - 予約あり（spot.is_fixed）なら reservation_time を使用
  // - 予約なしの目安時刻なら bhRule.targetTime を使用（「予約まで待機●分」は出さない）
  const [hasTargetTime, setHasTargetTime] = useState<boolean>(
    Boolean(initial.is_fixed || bhRule.targetTime),
  );
  const [resTimeHHMM, setResTimeHHMM] = useState<string | null>(
    initial.reservation_time
      ? toTokyoHHMM(initial.reservation_time)
      : bhRule.targetTime ?? null,
  );
  const [checkInDate, setCheckInDate] = useState<string>(
    initial.check_in ? toTokyoDate(new Date(initial.check_in)) : baseDefaultDate,
  );
  const [checkInHHMM, setCheckInHHMM] = useState<string | null>(
    initial.check_in ? toTokyoHHMM(initial.check_in) : isNew ? "15:00" : null,
  );
  const [checkOutDate, setCheckOutDate] = useState<string>(
    initial.check_out
      ? toTokyoDate(new Date(initial.check_out))
      : addDays(baseDefaultDate, 1),
  );
  const [checkOutHHMM, setCheckOutHHMM] = useState<string | null>(
    initial.check_out ? toTokyoHHMM(initial.check_out) : isNew ? "10:00" : null,
  );
  const [hasCheckInOut, setHasCheckInOut] = useState<boolean>(
    initial.category === "lodging" || initial.check_in !== null || initial.check_out !== null,
  );
  const [saving, setSaving] = useState(false);

  // 選択中の Day における「1つ前のスポット」と「前の出発予定時刻」を算出
  const { prevCoords, earliestArrivalHHMM, overrunMinutes } = useMemo(() => {
    const daySpots = spotsOfDay(allSpots, selectedDay.day_index);
    const coSpot = checkoutByDay.get(selectedDay.day_index) ?? null;
    const isSameDayAsInitial = !isNew && initial.day_index === selectedDay.day_index;
    const idx = isSameDayAsInitial
      ? daySpots.findIndex((s) => s.id === spot.id)
      : daySpots.length;

    const precedingSpots = idx > 0 ? daySpots.slice(0, idx) : [];
    const lastPrev = precedingSpots.length > 0 ? precedingSpots[precedingSpots.length - 1] : null;

    let coords: LatLng | null = null;
    if (lastPrev) {
      if (lastPrev.lat !== null && lastPrev.lng !== null) {
        coords = { lat: lastPrev.lat, lng: lastPrev.lng };
      }
    } else if (selectedDay.departure_lat !== null && selectedDay.departure_lng !== null) {
      coords = { lat: selectedDay.departure_lat, lng: selectedDay.departure_lng };
    } else if (coSpot && coSpot.lat !== null && coSpot.lng !== null) {
      coords = { lat: coSpot.lat, lng: coSpot.lng };
    }

    // 前のスポット終了時刻＋移動時間から「最短で到着できる時刻」を計算
    let earliestHHMM: string | null = null;
    let overrun = 0;
    if (selectedDay.date && (selectedDay.departure_time || coSpot?.check_out)) {
      const sched = computeDaySchedule(selectedDay, precedingSpots, coSpot);
      if (sched.end) {
        const prevEndMs = Date.parse(sched.end);
        const travelMs = (spot.transport_duration_minutes ?? 0) * 60_000;
        const earliestMs = prevEndMs + travelMs;
        earliestHHMM = toTokyoHHMM(toTokyoISO(new Date(earliestMs)));

        if (hasTargetTime && resTimeHHMM) {
          const targetIso = combineDateTime(selectedDay.date, resTimeHHMM);
          const targetMs = Date.parse(targetIso);
          if (earliestMs > targetMs) {
            overrun = Math.round((earliestMs - targetMs) / 60_000);
          }
        }
      }
    }

    return { prevCoords: coords, earliestArrivalHHMM: earliestHHMM, overrunMinutes: overrun };
  }, [
    allSpots,
    checkoutByDay,
    hasTargetTime,
    initial.day_index,
    isNew,
    resTimeHHMM,
    selectedDay,
    spot.id,
    spot.transport_duration_minutes,
  ]);

  // フォーム内での営業時間・定休日アラート即時プレビュー
  const liveBhAlert = useMemo(() => {
    if (spot.category === "lodging") {
      return hasCheckInOut ? checkLodgingPolicyAlert(bhRule, checkInHHMM, checkOutHHMM) : null;
    }
    const checkArr = hasTargetTime && resTimeHHMM ? resTimeHHMM : earliestArrivalHHMM;
    const checkDep = checkArr ? addMinutesHHMM(checkArr, spot.stay_minutes) : null;
    return checkBusinessHoursAlert(bhRule, dayDate, checkArr, checkDep);
  }, [
    bhRule,
    checkInHHMM,
    checkOutHHMM,
    dayDate,
    earliestArrivalHHMM,
    hasCheckInOut,
    hasTargetTime,
    resTimeHHMM,
    spot.category,
    spot.stay_minutes,
  ]);

  // 「何時までに前の場所を出ればOKか」のフォーム内プレビュー
  const liveLeaveBy = useMemo(() => {
    const travel = spot.transport_duration_minutes ?? 0;
    if (spot.category === "lodging" && hasCheckInOut && checkInHHMM) {
      return {
        hhmm: addMinutesHHMM(checkInHHMM, 24 * 60 - travel),
        reason: `${checkInHHMM}チェックイン`,
      };
    }
    if (hasTargetTime && resTimeHHMM) {
      return {
        hhmm: addMinutesHHMM(resTimeHHMM, 24 * 60 - travel),
        reason: spot.is_fixed ? `${resTimeHHMM}予約` : `目安 ${resTimeHHMM}`,
      };
    }
    if (bhRule.close) {
      return {
        hhmm: addMinutesHHMM(bhRule.close, 24 * 60 - spot.stay_minutes - travel),
        reason: `${bhRule.close}閉店（滞在${spot.stay_minutes}分）`,
      };
    }
    return null;
  }, [
    bhRule.close,
    checkInHHMM,
    hasCheckInOut,
    resTimeHHMM,
    spot.category,
    spot.is_fixed,
    spot.stay_minutes,
    spot.transport_duration_minutes,
  ]);

  async function handleSelectDay(newDayIdx: number) {
    const targetDay = days.find((d) => d.day_index === newDayIdx);
    const targetDaySpots = spotsOfDay(allSpots, newDayIdx).filter((s) => s.id !== spot.id);
    setSpot((prev) => ({
      ...prev,
      day_index: newDayIdx,
      sort_order: newDayIdx === initial.day_index && !isNew ? prev.sort_order : targetDaySpots.length,
    }));
    if (targetDay?.date && spot.category === "lodging") {
      setCheckInDate(targetDay.date);
      setCheckOutDate(addDays(targetDay.date, 1));
    }
  }

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
        suggested_category?: SpotRow["category"];
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
        category: data.suggested_category ?? prev.category,
        address: data.address ?? prev.address,
        lat: data.lat ?? prev.lat,
        lng: data.lng ?? prev.lng,
        place_url: data.place_url ?? gmapUrl.trim(),
      }));
      if (data.suggested_category === "lodging") {
        setHasCheckInOut(true);
      }

      if (data.business_hours) {
        setBhRule(data.business_hours);
      }

      if (
        prevCoords &&
        data.lat !== null &&
        data.lat !== undefined &&
        data.lng !== null &&
        data.lng !== undefined &&
        (spot.transport_mode === "car" ||
          spot.transport_mode === "walk" ||
          spot.transport_mode === "train")
      ) {
        try {
          const r = await getRouteProvider().route(
            prevCoords,
            { lat: data.lat, lng: data.lng },
            spot.transport_mode,
            { avoidTolls: Boolean(bhRule.avoidTolls) },
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
        spot.is_fixed && hasTargetTime && resTimeHHMM
          ? combineDateTime(baseDate, resTimeHHMM)
          : null;
      const targetTimeForNote =
        !spot.is_fixed && hasTargetTime && resTimeHHMM ? resTimeHHMM : null;
      const check_in =
        spot.category === "lodging" && hasCheckInOut && checkInDate && checkInHHMM
          ? combineDateTime(checkInDate, checkInHHMM)
          : null;
      const check_out =
        spot.category === "lodging" && hasCheckInOut && checkOutDate && checkOutHHMM
          ? combineDateTime(checkOutDate, checkOutHHMM)
          : null;

      let resolvedLat = spot.lat;
      let resolvedLng = spot.lng;
      if ((resolvedLat === null || resolvedLng === null) && (spot.address?.trim() || spot.name.trim())) {
        try {
          const geo = await geocodeSpot(spot.address, spot.name);
          if (geo) {
            resolvedLat = geo.lat;
            resolvedLng = geo.lng;
          }
        } catch {
          // 座標補完失敗時はそのまま保存
        }
      }

      await onSave({
        ...spot,
        lat: resolvedLat,
        lng: resolvedLng,
        is_fixed: Boolean(spot.is_fixed && hasTargetTime && resTimeHHMM),
        name: spot.name.trim(),
        place_url: gmapUrl.trim() ? gmapUrl.trim() : spot.place_url,
        transport_note: serializeBusinessHours({
          ...bhRule,
          targetTime: targetTimeForNote,
        }),
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
                placeholder="https://maps.app.goo.gl/... または share.google/..."
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

          {/* 旅程の何日目に行くか（候補プールに入れておく or Day 1 / Day 2... を変更可能） */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              <span>訪問する日程（日付未定なら「候補プール」に入れてあとで自動編成できます）</span>
            </label>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => handleSelectDay(0)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border whitespace-nowrap transition ${
                  spot.day_index === 0
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-indigo-50/70 text-indigo-800 border-indigo-200 hover:bg-indigo-100"
                }`}
              >
                📌 候補プール（日程未定）
              </button>
              {days
                .filter((d) => d.day_index >= 1)
                .map((d) => {
                  const active = d.day_index === spot.day_index;
                  return (
                    <button
                      key={d.day_index}
                      type="button"
                      onClick={() => handleSelectDay(d.day_index)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border whitespace-nowrap transition ${
                        active
                          ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span>{d.label}</span>
                      {d.date && (
                        <span
                          className={`ml-1 text-[10px] font-normal ${
                            active ? "text-slate-300" : "text-slate-400"
                          }`}
                        >
                          ({d.date.slice(5).replace("-", "/")})
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
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

          {/* 状態（決まった / 候補 / 未定） */}
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
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
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

          {/* 🎯 枠タグ（複数選択可：「1日目昼食」「2日目温泉」など、同じタグの候補から1つだけ選びたい・振り分けたいとき） */}
          {spot.category !== "lodging" && (
            <div className="rounded-2xl bg-purple-50/70 border border-purple-200 p-3 space-y-2.5">
              <div>
                <div className="text-xs font-extrabold text-purple-950">
                  🎯 枠タグ（複数選択可・「どっちか1つ」選抜 ＆ 時間帯振り分け用）
                </div>
                <p className="text-[11px] text-purple-800 leading-relaxed mt-0.5">
                  例：迷っている2軒に「1日目昼食」を付けると自動編成で<strong>最適な1軒だけ</strong>が選ばれ、もう1軒は候補プールに残ります。「1日目昼食」と「1日目夕食」の両方を付けておけば<strong>ルートに合わせて昼と夜に自動振り分け</strong>されます。
                </p>
              </div>

              {/* プリセット＆既存枠タグのピル一覧 */}
              <div className="flex flex-wrap gap-1.5">
                {availableSlotPresets.map((preset) => {
                  const selected = (bhRule.slotTags ?? []).some((x) => x.id === preset.id);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => toggleSlotTag(preset)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border transition ${
                        selected
                          ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                          : "bg-white text-purple-900 border-purple-200 hover:bg-purple-100/60"
                      }`}
                    >
                      <span>{preset.label}</span>
                      <span
                        className={`ml-1 text-[10px] font-mono ${
                          selected ? "text-purple-100" : "text-purple-400"
                        }`}
                      >
                        ({preset.windowStart}-{preset.windowEnd})
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 選択中の枠タグの時間帯（目安開始〜終了）調整 */}
              {(bhRule.slotTags ?? []).length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-purple-200/80">
                  <div className="text-[10px] font-bold text-purple-900">
                    選択中の枠タグの目安時間帯（変更すると自動編成時にこの時間帯へ配置されます）
                  </div>
                  {(bhRule.slotTags ?? []).map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between gap-2 bg-white rounded-xl border border-purple-200 px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-bold text-purple-950 truncate">{st.label}</span>
                      <div className="flex items-center gap-1 shrink-0 font-mono">
                        <TimeSelect
                          allowUndecided={false}
                          value={st.windowStart}
                          onChange={(val) =>
                            updateSlotWindow(st.id, "windowStart", val ?? "11:30")
                          }
                          className="border-purple-200"
                        />
                        <span>〜</span>
                        <TimeSelect
                          allowUndecided={false}
                          value={st.windowEnd}
                          onChange={(val) =>
                            updateSlotWindow(st.id, "windowEnd", val ?? "13:30")
                          }
                          className="border-purple-200"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 自由な枠タグを追加 */}
              <div className="flex items-center flex-wrap gap-1.5 pt-1">
                <input
                  type="text"
                  value={customSlotName}
                  onChange={(e) => setCustomSlotName(e.target.value)}
                  placeholder="自由な枠名 (例: 1日目おやつ)"
                  className="flex-1 min-w-[130px] px-2.5 py-1 rounded-lg border border-purple-200 bg-white text-xs"
                />
                <TimeSelect
                  allowUndecided={false}
                  value={customSlotStart}
                  onChange={(val) => setCustomSlotStart(val ?? "12:00")}
                  className="border-purple-200"
                />
                <span className="text-xs text-purple-700">〜</span>
                <TimeSelect
                  allowUndecided={false}
                  value={customSlotEnd}
                  onChange={(val) => setCustomSlotEnd(val ?? "14:00")}
                  className="border-purple-200"
                />
                <button
                  type="button"
                  onClick={handleAddCustomSlotTag}
                  className="px-2.5 py-1 rounded-lg bg-purple-700 text-white text-xs font-bold hover:bg-purple-800 shrink-0"
                >
                  ＋枠作成
                </button>
              </div>
            </div>
          )}

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

          {/* 宿泊スポット専用: 施設の規定チェックイン/アウト可能時間 ＆ 実際の予定チェックイン/アウト時刻 */}
          {spot.category === "lodging" && (
            <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-purple-950">
                  宿泊チェックイン・アウト設定
                </span>
                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-800">
                  <input
                    type="checkbox"
                    checked={hasCheckInOut}
                    onChange={(e) => setHasCheckInOut(e.target.checked)}
                  />
                  時刻を指定する
                </label>
              </div>
              {hasCheckInOut && (
                <>
                  {/* 1. ホテル・キャンプ場の規定時間（最速IN / 最終OUT） */}
                  <div className="rounded-lg bg-white/90 border border-purple-200 p-2.5 space-y-1.5">
                    <div className="text-[11px] font-bold text-purple-900">
                      ① 施設側の規定時間（任意・入力すると予定時刻が範囲外のとき警告します）
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-purple-700 mb-0.5">
                          最速チェックイン可能（〜から）
                        </label>
                        <TimeSelect
                          value={bhRule.policyCheckIn}
                          defaultHour="14"
                          onChange={(val) =>
                            setBhRule((prev) => ({
                              ...prev,
                              policyCheckIn: val,
                            }))
                          }
                          className="w-full justify-between border-purple-200"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-purple-700 mb-0.5">
                          最終チェックアウト期限（〜まで）
                        </label>
                        <TimeSelect
                          value={bhRule.policyCheckOut}
                          defaultHour="11"
                          onChange={(val) =>
                            setBhRule((prev) => ({
                              ...prev,
                              policyCheckOut: val,
                            }))
                          }
                          className="w-full justify-between border-purple-200"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2. 実際の旅程での予定チェックイン・チェックアウト */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold text-purple-950">
                      ② 私たちの予定チェックイン・チェックアウト日時（翌日の出発時刻に自動連動）
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-purple-800 mb-1">
                          予定チェックイン
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
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-xl border border-purple-200 bg-white text-xs"
                          />
                          <TimeSelect
                            value={checkInHHMM}
                            defaultHour="15"
                            onChange={setCheckInHHMM}
                            className="border-purple-200 shrink-0"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-purple-800 mb-1">
                          予定チェックアウト（翌日の出発時刻）
                        </label>
                        <div className="flex gap-1 items-center">
                          <input
                            type="date"
                            min={checkInDate || undefined}
                            value={checkOutDate}
                            onChange={(e) => setCheckOutDate(e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-xl border border-purple-200 bg-white text-xs"
                          />
                          <TimeSelect
                            value={checkOutHHMM}
                            defaultHour="10"
                            onChange={setCheckOutHHMM}
                            className="border-purple-200 shrink-0"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {liveLeaveBy && (
                    <div className="text-[11px] font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                      🕒 前の地点を <strong>{liveLeaveBy.hhmm} までに</strong> 出発すれば{" "}
                      {liveLeaveBy.reason} に間に合います
                    </div>
                  )}

                  {liveBhAlert && (
                    <div className="flex items-start gap-1.5 rounded-xl bg-amber-600 text-white px-3 py-2 text-xs font-bold shadow-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{liveBhAlert}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 何時ごろ行きたいか（希望到着時刻・予約時刻）＆ 滞在時間 */}
          {!(spot.category === "lodging" && hasCheckInOut) && (
            <div className="rounded-xl bg-indigo-50/60 border border-indigo-200 p-3 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-bold text-indigo-950 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-indigo-600" />
                  <span>訪問時間・滞在時間（何時ごろ行きたいか）</span>
                </span>
                {earliestArrivalHHMM && (
                  <span className="text-[11px] font-mono text-indigo-800 bg-white px-2 py-0.5 rounded border border-indigo-200">
                    前の予定からの到着見込み: <strong>{earliestArrivalHHMM}</strong>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-indigo-950">
                      行きたい時刻 / 予約時刻
                    </label>
                    <label className="inline-flex items-center gap-1 text-xs font-bold text-indigo-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasTargetTime}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setHasTargetTime(checked);
                          if (!checked) {
                            setSpot((s) => ({ ...s, is_fixed: false }));
                            setResTimeHHMM(null);
                          } else if (!resTimeHHMM) {
                            setResTimeHHMM("12:00");
                          }
                        }}
                      />
                      時間を指定する
                    </label>
                  </div>
                  <TimeSelect
                    disabled={!hasTargetTime}
                    value={hasTargetTime ? resTimeHHMM : null}
                    defaultHour="12"
                    onChange={(val) => {
                      if (val === null) {
                        setHasTargetTime(false);
                        setSpot((s) => ({ ...s, is_fixed: false }));
                        setResTimeHHMM(null);
                      } else {
                        setHasTargetTime(true);
                        setResTimeHHMM(val);
                      }
                    }}
                    className="w-full justify-between border-indigo-200"
                  />
                  {hasTargetTime && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-900 cursor-pointer pt-0.5">
                      <input
                        type="checkbox"
                        checked={spot.is_fixed}
                        onChange={(e) => setSpot((s) => ({ ...s, is_fixed: e.target.checked }))}
                      />
                      <span>予約あり（時間固定・待機や遅刻アラートの対象にする）</span>
                    </label>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-indigo-950 mb-1.5">
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
                    className="w-full px-3 py-2 rounded-xl border border-indigo-200 bg-white font-mono"
                  />
                </div>
              </div>

              {/* 何時までに前の場所を出ればOKかの一目表示 */}
              {liveLeaveBy && (
                <div className="text-[11px] font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  🕒 前の地点を <strong>{liveLeaveBy.hhmm} までに</strong> 出発すれば{" "}
                  {liveLeaveBy.reason} に間に合います
                </div>
              )}

              {/* 旅程的に無理がある場合のリアルタイム警告 */}
              {overrunMinutes > 0 && spot.is_fixed && (
                <div className="flex items-start gap-1.5 rounded-xl bg-red-600 text-white px-3 py-2 text-xs font-bold shadow-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    ⚠️ 前の予定からの移動が予約に間に合いません：{overrunMinutes}分超過（予約 {resTimeHHMM}{" "}
                    / 最短到着見込み {earliestArrivalHHMM}）
                  </span>
                </div>
              )}
              {overrunMinutes > 0 && !spot.is_fixed && (
                <div className="flex items-start gap-1.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 px-3 py-2 text-xs font-bold">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                  <span>
                    目安時刻（{resTimeHHMM}）より {overrunMinutes}分遅れて到着する見込みです（最短到着 {earliestArrivalHHMM}）
                  </span>
                </div>
              )}
              {liveBhAlert && (
                <div className="flex items-start gap-1.5 rounded-xl bg-amber-600 text-white px-3 py-2 text-xs font-bold shadow-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{liveBhAlert}</span>
                </div>
              )}
            </div>
          )}

          {/* 営業時間・定休日（自動取得＋手動調整） */}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-amber-900 mb-0.5">開店時刻</label>
                  <TimeSelect
                    value={bhRule.open}
                    defaultHour="10"
                    onChange={(val) => setBhRule((prev) => ({ ...prev, open: val }))}
                    className="w-full justify-between border-amber-200"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-amber-900 mb-0.5">閉店時刻</label>
                  <TimeSelect
                    value={bhRule.close}
                    defaultHour="18"
                    onChange={(val) => setBhRule((prev) => ({ ...prev, close: val }))}
                    className="w-full justify-between border-amber-200"
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

          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">
            ※ 区間の移動手段（車・高速/下道・徒歩・電車）は、タイムライン上のスポット間にある移動ピルをタップして編集できます（初期値: 車・高速あり）。
          </p>

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

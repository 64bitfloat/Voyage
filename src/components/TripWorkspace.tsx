"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Plus,
  Share2,
  AlertTriangle,
  Navigation,
  Clock,
  Check,
  Calculator,
  Calendar,
  Sparkles,
  MapPin,
  Wallet,
  Backpack,
  Users,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  newSpot,
  type BelongingRow,
  type CostRow,
  type DayRow,
  type DishRow,
  type ParticipantRow,
  type PhotoRow,
  type SpotRow,
  type TripDoc,
} from "@/lib/model/types";
import { computeTripSchedule, spotsOfDay } from "@/lib/schedule/compute";
import { useTripSync } from "@/lib/realtime/sync";
import { getRouteProvider, type LatLng } from "@/lib/routing";
import { searchPlaces } from "@/lib/geo/geocode";
import { toTokyoHHMM } from "@/lib/datetime";
import type { PendingPin } from "./TripMap";
import SpotCard from "./SpotCard";
import SpotEditorModal from "./SpotEditorModal";
import PolaroidGallery from "./PolaroidGallery";
import ParticipantsPanel from "./ParticipantsPanel";
import CostsPanel from "./CostsPanel";
import PrepAndDishesPanel from "./PrepAndDishesPanel";
import MuseExportModal from "./MuseExportModal";
import PasscodeGateModal from "./PasscodeGateModal";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-slate-100 flex items-center justify-center text-xs text-slate-500">
      地図を読み込み中...
    </div>
  ),
});

type MainTab = "itinerary" | "costs" | "prep" | "members";

interface TripWorkspaceProps {
  initialDoc: TripDoc;
}

export default function TripWorkspace({ initialDoc }: TripWorkspaceProps) {
  const [doc, setDoc] = useState<TripDoc>(initialDoc);
  const [mainTab, setMainTab] = useState<MainTab>("itinerary");
  const [activeDayIdx, setActiveDayIdx] = useState<number>(
    initialDoc.days.find((d) => d.day_index === 1)?.day_index ?? 0,
  );
  const [mapExpanded, setMapExpanded] = useState(false);
  const [editingSpot, setEditingSpot] = useState<{ spot: SpotRow; isNew: boolean } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [depGeoBusy, setDepGeoBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (!initialDoc.trip.has_passcode) return true;
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem(`voyage:unlocked:${initialDoc.trip.id}`) === "1";
      } catch {
        return false;
      }
    }
    return false;
  });

  const tripId = doc.trip.id;

  const fetchLatest = useCallback(async () => {
    const res = await fetch(`/api/trips/${tripId}`, { cache: "no-store" });
    if (res.ok) {
      const latest = (await res.json()) as TripDoc;
      setDoc(latest);
    }
  }, [tripId]);

  const { notifyChange } = useTripSync(tripId, fetchLatest);

  const activeDay: DayRow = useMemo(
    () =>
      doc.days.find((d) => d.day_index === activeDayIdx) ??
      doc.days[0] ?? {
        day_index: 0,
        label: "出発前",
        date: null,
        departure_point: null,
        departure_lat: null,
        departure_lng: null,
        departure_time: null,
      },
    [doc.days, activeDayIdx],
  );

  const daySpots = useMemo(
    () => spotsOfDay(doc.spots, activeDay.day_index),
    [doc.spots, activeDay.day_index],
  );
  const schedule = useMemo(() => computeTripSchedule(doc.days, doc.spots), [doc.days, doc.spots]);
  const daySchedule = schedule.byDay.get(activeDay.day_index);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function getPrevCoordsFor(spotId: string | null, targetOrder?: number): LatLng | null {
    const list = daySpots;
    const idx = spotId ? list.findIndex((s) => s.id === spotId) : (targetOrder ?? list.length);
    if (idx <= 0) {
      if (activeDay.departure_lat !== null && activeDay.departure_lng !== null) {
        return { lat: activeDay.departure_lat, lng: activeDay.departure_lng };
      }
      return null;
    }
    const prev = list[idx - 1];
    return prev && prev.lat !== null && prev.lng !== null ? { lat: prev.lat, lng: prev.lng } : null;
  }

  async function recalculateDayRoutes(day: DayRow, ordered: SpotRow[]) {
    setRecalcBusy(true);
    try {
      const updated: SpotRow[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const s = ordered[i];
        const prev: LatLng | null =
          i === 0
            ? day.departure_lat !== null && day.departure_lng !== null
              ? { lat: day.departure_lat, lng: day.departure_lng }
              : null
            : ordered[i - 1].lat !== null && ordered[i - 1].lng !== null
              ? { lat: ordered[i - 1].lat!, lng: ordered[i - 1].lng! }
              : null;

        if (
          prev &&
          s.lat !== null &&
          s.lng !== null &&
          (s.transport_mode === "car" || s.transport_mode === "walk")
        ) {
          try {
            const r = await getRouteProvider().route(
              prev,
              { lat: s.lat, lng: s.lng },
              s.transport_mode,
            );
            const nextSpot: SpotRow = {
              ...s,
              sort_order: i,
              transport_duration_minutes: r.duration_minutes,
              transport_distance_m: r.distance_m,
            };
            updated.push(nextSpot);
            await fetch(`/api/trips/${tripId}/spots/${s.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transport_duration_minutes: r.duration_minutes,
                transport_distance_m: r.distance_m,
              }),
            });
            continue;
          } catch {
            // OSRM到達不可時は既存の移動時間を維持
          }
        }
        updated.push({ ...s, sort_order: i });
      }

      setDoc((prev) => ({
        ...prev,
        spots: [...prev.spots.filter((x) => x.day_index !== day.day_index), ...updated],
      }));
      notifyChange();
    } finally {
      setRecalcBusy(false);
    }
  }

  async function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIndex = daySpots.findIndex((s) => s.id === active.id);
    const newIndex = daySpots.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(daySpots, oldIndex, newIndex).map((s, idx) => ({
      ...s,
      sort_order: idx,
    }));

    setDoc((prev) => ({
      ...prev,
      spots: [...prev.spots.filter((s) => s.day_index !== activeDay.day_index), ...reordered],
    }));

    await fetch(`/api/trips/${tripId}/spots/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_index: activeDay.day_index,
        ordered_ids: reordered.map((s) => s.id),
      }),
    });
    notifyChange();

    void recalculateDayRoutes(activeDay, reordered);
  }

  async function handleSaveDayPatch(patch: Partial<DayRow>) {
    const nextDay: DayRow = { ...activeDay, ...patch };
    setDoc((prev) => ({
      ...prev,
      days: prev.days.map((d) => (d.day_index === nextDay.day_index ? nextDay : d)),
    }));
    await fetch(`/api/trips/${tripId}/days/${nextDay.day_index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    notifyChange();
  }

  async function handleGeocodeDeparture() {
    if (!activeDay.departure_point?.trim()) return;
    setDepGeoBusy(true);
    try {
      const r = await searchPlaces(activeDay.departure_point);
      if (r[0]) {
        const nextDay: DayRow = {
          ...activeDay,
          departure_lat: r[0].lat,
          departure_lng: r[0].lng,
        };
        await handleSaveDayPatch({ departure_lat: r[0].lat, departure_lng: r[0].lng });
        void recalculateDayRoutes(nextDay, daySpots);
      }
    } finally {
      setDepGeoBusy(false);
    }
  }

  async function handleAddDay() {
    const maxIdx = Math.max(0, ...doc.days.map((d) => d.day_index));
    const nextIdx = maxIdx + 1;
    const prevDate = doc.days.find((d) => d.day_index === maxIdx)?.date ?? doc.trip.start_date;
    let nextDate: string | null = null;
    if (prevDate) {
      const dt = new Date(`${prevDate}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      nextDate = dt.toISOString().slice(0, 10);
    }
    const newDay: DayRow = {
      day_index: nextIdx,
      label: `Day ${nextIdx}`,
      date: nextDate,
      departure_point: null,
      departure_lat: null,
      departure_lng: null,
      departure_time: "08:00",
    };
    setDoc((prev) => ({ ...prev, days: [...prev.days, newDay] }));
    setActiveDayIdx(nextIdx);
    await fetch(`/api/trips/${tripId}/days/${nextIdx}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newDay),
    });
    notifyChange();
  }

  function openNewSpotModal(pin?: PendingPin) {
    const draft = newSpot({
      id: crypto.randomUUID(),
      day_index: activeDay.day_index,
      sort_order: daySpots.length,
      name: pin?.name ?? "",
      address: pin?.address ?? null,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      place_url: pin ? `https://maps.google.com/?q=${pin.lat},${pin.lng}` : null,
      transport_mode: activeDay.day_index === 0 ? null : "car",
    });
    setEditingSpot({ spot: draft, isNew: true });
  }

  async function handleSaveSpot(spot: SpotRow) {
    let finalSpot = spot;
    const prev = getPrevCoordsFor(editingSpot?.isNew ? null : spot.id, spot.sort_order);
    if (
      finalSpot.transport_duration_minutes === null &&
      prev &&
      finalSpot.lat !== null &&
      finalSpot.lng !== null &&
      (finalSpot.transport_mode === "car" || finalSpot.transport_mode === "walk")
    ) {
      try {
        const r = await getRouteProvider().route(
          prev,
          { lat: finalSpot.lat, lng: finalSpot.lng },
          finalSpot.transport_mode,
        );
        finalSpot = {
          ...finalSpot,
          transport_duration_minutes: r.duration_minutes,
          transport_distance_m: r.distance_m,
        };
      } catch {
        // 失敗時は未設定のまま保存
      }
    }

    if (editingSpot?.isNew) {
      setDoc((d) => ({ ...d, spots: [...d.spots, finalSpot] }));
      await fetch(`/api/trips/${tripId}/spots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalSpot),
      });
    } else {
      setDoc((d) => ({
        ...d,
        spots: d.spots.map((x) => (x.id === finalSpot.id ? finalSpot : x)),
      }));
      await fetch(`/api/trips/${tripId}/spots/${finalSpot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalSpot),
      });
    }
    notifyChange();
  }

  async function handleDeleteSpot(spotId: string) {
    setDoc((d) => ({
      ...d,
      spots: d.spots.filter((x) => x.id !== spotId),
      photos: d.photos.filter((p) => p.spot_id !== spotId),
    }));
    await fetch(`/api/trips/${tripId}/spots/${spotId}`, { method: "DELETE" });
    notifyChange();
  }

  /* ---- 段階3 エンティティ保存ハンドラ ---- */

  async function handleUpsertParticipant(p: ParticipantRow) {
    setDoc((d) => {
      const exists = d.participants.some((x) => x.id === p.id);
      return {
        ...d,
        participants: exists
          ? d.participants.map((x) => (x.id === p.id ? p : x))
          : [...d.participants, p],
      };
    });
    await fetch(`/api/trips/${tripId}/participants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    notifyChange();
  }

  async function handleDeleteParticipant(id: string) {
    setDoc((d) => ({ ...d, participants: d.participants.filter((x) => x.id !== id) }));
    await fetch(`/api/trips/${tripId}/participants`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    notifyChange();
  }

  async function handleUpsertCost(c: CostRow) {
    setDoc((d) => {
      const exists = d.costs.some((x) => x.id === c.id);
      return {
        ...d,
        costs: exists ? d.costs.map((x) => (x.id === c.id ? c : x)) : [...d.costs, c],
      };
    });
    await fetch(`/api/trips/${tripId}/costs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    notifyChange();
  }

  async function handleDeleteCost(id: string) {
    setDoc((d) => ({ ...d, costs: d.costs.filter((x) => x.id !== id) }));
    await fetch(`/api/trips/${tripId}/costs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    notifyChange();
  }

  async function handleUpsertBelonging(b: BelongingRow) {
    setDoc((d) => {
      const exists = d.belongings.some((x) => x.id === b.id);
      return {
        ...d,
        belongings: exists
          ? d.belongings.map((x) => (x.id === b.id ? b : x))
          : [...d.belongings, b],
      };
    });
    await fetch(`/api/trips/${tripId}/belongings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    notifyChange();
  }

  async function handleDeleteBelonging(id: string) {
    setDoc((d) => ({ ...d, belongings: d.belongings.filter((x) => x.id !== id) }));
    await fetch(`/api/trips/${tripId}/belongings`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    notifyChange();
  }

  async function handleUpsertDish(dish: DishRow) {
    setDoc((d) => {
      const exists = d.dishes.some((x) => x.id === dish.id);
      return {
        ...d,
        dishes: exists ? d.dishes.map((x) => (x.id === dish.id ? dish : x)) : [...d.dishes, dish],
      };
    });
    await fetch(`/api/trips/${tripId}/dishes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dish),
    });
    notifyChange();
  }

  async function handleDeleteDish(id: string) {
    setDoc((d) => ({ ...d, dishes: d.dishes.filter((x) => x.id !== id) }));
    await fetch(`/api/trips/${tripId}/dishes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    notifyChange();
  }

  async function handleAddPhoto(photo: PhotoRow) {
    setDoc((d) => ({ ...d, photos: [...d.photos, photo] }));
    const res = await fetch(`/api/trips/${tripId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(photo),
    });
    if (res.ok) {
      const saved = (await res.json()) as PhotoRow;
      setDoc((d) => ({
        ...d,
        photos: d.photos.map((p) => (p.id === saved.id ? saved : p)),
      }));
    }
    notifyChange();
  }

  async function handleDeletePhoto(id: string) {
    setDoc((d) => ({ ...d, photos: d.photos.filter((x) => x.id !== id) }));
    await fetch(`/api/trips/${tripId}/photos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    notifyChange();
  }

  async function handleCopyShareUrl() {
    await navigator.clipboard.writeText(window.location.href);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  return (
    <div className="h-dvh flex flex-col bg-[#f5f6f8] text-slate-900 overflow-hidden">
      {/* パスコードロック画面（初回アクセス時のみ） */}
      {!unlocked && (
        <PasscodeGateModal
          tripId={tripId}
          tripTitle={doc.trip.title}
          onUnlocked={() => setUnlocked(true)}
        />
      )}

      {/* iOS Voyage 風グラスモーフィズムヘッダー */}
      <header className="px-3.5 py-2.5 bg-white/90 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between gap-2 shrink-0 z-10">
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base font-extrabold tracking-tight truncate text-slate-900">
            {doc.trip.title}
          </h1>
          <div className="text-[11px] text-slate-500 flex items-center gap-2">
            {doc.trip.start_date && (
              <span className="inline-flex items-center gap-1 font-medium">
                <Calendar className="w-3 h-3 text-blue-600" />
                {doc.trip.start_date}
                {doc.trip.end_date ? ` 〜 ${doc.trip.end_date}` : ""}
              </span>
            )}
            {schedule.conflicts.length > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-red-100 text-red-700 font-bold">
                <AlertTriangle className="w-3 h-3" />
                破綻 {schedule.conflicts.length}件
              </span>
            )}
          </div>
        </div>

        {/* 右上アクション（共有URL + 第5.1章「Muse連携用データを出力」ボタン） */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyShareUrl}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
          >
            {copiedUrl ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Share2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{copiedUrl ? "コピー済" : "共有"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-xs font-extrabold shadow-sm hover:from-indigo-700 hover:to-blue-700"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Muse連携用データを出力</span>
          </button>
        </div>
      </header>

      {/* メインコンテンツ（タブに応じて切替） */}
      {mainTab === "itinerary" ? (
        <>
          {/* 上部: インタラクティブ地図（サイズ切替トグル付き） */}
          <div
            className={`relative w-full shrink-0 transition-all duration-200 ${
              mapExpanded ? "h-[54vh]" : "h-[33vh] min-h-[200px] max-h-[320px]"
            }`}
          >
            <TripMap
              day={activeDay}
              spots={daySpots}
              onPickPlace={(pin) => openNewSpotModal(pin)}
              onSelectSpot={(spot) => setEditingSpot({ spot, isNew: false })}
            />
            <button
              type="button"
              onClick={() => setMapExpanded((v) => !v)}
              className="absolute bottom-3 right-3 z-[1000] p-2 rounded-xl bg-white/95 shadow-md border border-slate-200 text-slate-700 hover:bg-slate-50"
              title={mapExpanded ? "地図を縮小" : "地図を拡大"}
            >
              {mapExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Voyage ボトムシート風タイムラインパネル */}
          <div className="flex-1 flex flex-col min-h-0 -mt-3 z-10 rounded-t-3xl bg-[#f5f6f8] shadow-[0_-6px_20px_rgba(15,23,42,0.08)] border-t border-slate-200/80 overflow-hidden">
            {/* シートハンドル + 日程セグメントピルタブ（出発前 / Day 1 / Day 2 ...） */}
            <div className="bg-white px-3 pt-2 pb-2 border-b border-slate-200/80 shrink-0">
              <div className="w-9 h-1 rounded-full bg-slate-300 mx-auto mb-2" />
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {doc.days.map((d) => {
                  const active = d.day_index === activeDay.day_index;
                  const dayConflicts = schedule.byDay.get(d.day_index)?.conflicts.length ?? 0;
                  return (
                    <button
                      key={d.day_index}
                      type="button"
                      onClick={() => setActiveDayIdx(d.day_index)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1 ${
                        active
                          ? "bg-slate-900 text-white shadow-xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      <span>{d.label}</span>
                      {d.date && (
                        <span
                          className={`text-[10px] font-medium ${
                            active ? "text-slate-300" : "text-slate-400"
                          }`}
                        >
                          {d.date.slice(5).replace("-", "/")}
                        </span>
                      )}
                      {dayConflicts > 0 && (
                        <span
                          className="w-2 h-2 rounded-full bg-red-500 inline-block"
                          title="時刻超過あり"
                        />
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={handleAddDay}
                  className="px-3 py-1.5 rounded-full text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 whitespace-nowrap"
                >
                  ＋日程追加
                </button>
              </div>
            </div>

            {/* タイムライン本体 */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {/* 出発設定カード（Day 1 以降） */}
              {activeDay.day_index > 0 && (
                <div className="rounded-2xl bg-white border border-slate-200/90 p-3 space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800">
                      <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                      <span>出発地点・出発時刻</span>
                    </div>
                    {daySpots.length > 0 && (
                      <button
                        type="button"
                        disabled={recalcBusy}
                        onClick={() => recalculateDayRoutes(activeDay, daySpots)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                      >
                        <Calculator className="w-3 h-3" />
                        {recalcBusy ? "ルート計算中..." : "移動時間を再計算"}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-3 flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500 shrink-0">日付</span>
                      <input
                        type="date"
                        value={activeDay.date ?? ""}
                        onChange={(e) => handleSaveDayPatch({ date: e.target.value || null })}
                        className="w-full px-2 py-1.5 rounded-xl border border-slate-300 text-xs"
                      />
                    </div>

                    <div className="sm:col-span-3 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-[11px] text-slate-500 shrink-0">出発</span>
                      <input
                        type="time"
                        value={activeDay.departure_time ?? ""}
                        onChange={(e) =>
                          handleSaveDayPatch({ departure_time: e.target.value || null })
                        }
                        className="w-full px-2 py-1.5 rounded-xl border border-slate-300 text-xs font-mono font-bold"
                      />
                    </div>

                    <div className="sm:col-span-6 flex items-center gap-1.5">
                      <input
                        type="text"
                        value={activeDay.departure_point ?? ""}
                        onChange={(e) =>
                          setDoc((prev) => ({
                            ...prev,
                            days: prev.days.map((d) =>
                              d.day_index === activeDay.day_index
                                ? { ...d, departure_point: e.target.value || null }
                                : d,
                            ),
                          }))
                        }
                        onBlur={(e) =>
                          handleSaveDayPatch({ departure_point: e.target.value || null })
                        }
                        placeholder="出発地点（例: 自宅 / 新宿駅）"
                        className="flex-1 px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs"
                      />
                      <button
                        type="button"
                        disabled={depGeoBusy}
                        onClick={handleGeocodeDeparture}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 shrink-0"
                      >
                        {depGeoBusy ? "..." : "座標取得"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* スポット一覧（Voyage風クロノグラフ軸 + D&D） */}
              {daySpots.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-6 text-center space-y-2.5">
                  <p className="text-xs text-slate-600">
                    上の地図を検索またはタップしてピンを立て、「しおりに追加」を押してください。
                  </p>
                  <button
                    type="button"
                    onClick={() => openNewSpotModal()}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-xs hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4" />
                    スポットを直接追加
                  </button>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={daySpots.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div>
                      {daySpots.map((spot, idx) => (
                        <SpotCard
                          key={spot.id}
                          index={idx}
                          spot={spot}
                          timing={daySchedule?.timings[spot.id]}
                          photos={doc.photos.filter((p) => p.spot_id === spot.id)}
                          onEdit={(s) => setEditingSpot({ spot: s, isNew: false })}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              <div className="flex items-center justify-between pt-1">
                {daySchedule?.end ? (
                  <span className="text-xs text-slate-500 font-mono font-bold">
                    🏁 全行程終了予定: {toTokyoHHMM(daySchedule.end)}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => openNewSpotModal()}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-2xl bg-blue-600 text-white text-xs font-extrabold shadow-sm hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" />
                  スポットを追加
                </button>
              </div>

              {/* 第4章: 思い出写真＆チェキ風タイムライン */}
              <PolaroidGallery
                day={activeDay}
                spots={daySpots}
                photos={doc.photos}
                participants={doc.participants}
                onAddPhoto={handleAddPhoto}
                onDeletePhoto={handleDeletePhoto}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-3.5 py-4 max-w-3xl w-full mx-auto">
          {mainTab === "costs" && (
            <CostsPanel
              costs={doc.costs}
              participants={doc.participants}
              days={doc.days}
              spots={doc.spots}
              onUpsert={handleUpsertCost}
              onDelete={handleDeleteCost}
            />
          )}
          {mainTab === "prep" && (
            <PrepAndDishesPanel
              belongings={doc.belongings}
              dishes={doc.dishes}
              participants={doc.participants}
              days={doc.days}
              onUpsertBelonging={handleUpsertBelonging}
              onDeleteBelonging={handleDeleteBelonging}
              onUpsertDish={handleUpsertDish}
              onDeleteDish={handleDeleteDish}
            />
          )}
          {mainTab === "members" && (
            <div className="space-y-6">
              <ParticipantsPanel
                participants={doc.participants}
                onUpsert={handleUpsertParticipant}
                onDelete={handleDeleteParticipant}
              />

              {/* 全体メモ（構造化できない補足のみ） */}
              <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2 shadow-2xs">
                <label className="block text-xs font-extrabold text-slate-800">
                  全体メモ（自由記述・構造化できない補足のみ）
                </label>
                <textarea
                  rows={3}
                  defaultValue={doc.trip.notes}
                  onBlur={async (e) => {
                    const notes = e.target.value;
                    if (notes === doc.trip.notes) return;
                    setDoc((d) => ({ ...d, trip: { ...d.trip, notes } }));
                    await fetch(`/api/trips/${tripId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ notes }),
                    });
                    notifyChange();
                  }}
                  placeholder="集合時の注意事項など"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* iOS ネイティブアプリ風・下部タブバー */}
      <nav className="bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 grid grid-cols-4 gap-1 shrink-0 z-20">
        <button
          type="button"
          onClick={() => setMainTab("itinerary")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "itinerary" ? "text-blue-600 font-extrabold" : "text-slate-500"
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">旅程・写真</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("costs")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "costs" ? "text-blue-600 font-extrabold" : "text-slate-500"
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">費用({doc.costs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("prep")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "prep" ? "text-blue-600 font-extrabold" : "text-slate-500"
          }`}
        >
          <Backpack className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">
            持ち物・料理({doc.belongings.length + doc.dishes.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("members")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "members" ? "text-blue-600 font-extrabold" : "text-slate-500"
          }`}
        >
          <Users className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">参加者({doc.participants.length})</span>
        </button>
      </nav>

      {/* スポット追加・編集モーダル */}
      {editingSpot && (
        <SpotEditorModal
          dayIndex={activeDay.day_index}
          dayDate={activeDay.date}
          prevCoords={getPrevCoordsFor(
            editingSpot.isNew ? null : editingSpot.spot.id,
            editingSpot.spot.sort_order,
          )}
          initial={editingSpot.spot}
          isNew={editingSpot.isNew}
          onSave={handleSaveSpot}
          onDelete={handleDeleteSpot}
          onClose={() => setEditingSpot(null)}
        />
      )}

      {/* Muse連携エクスポートモーダル */}
      {showExportModal && (
        <MuseExportModal doc={doc} onClose={() => setShowExportModal(false)} />
      )}
    </div>
  );
}

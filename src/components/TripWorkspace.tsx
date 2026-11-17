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
} from "lucide-react";
import { newSpot, type DayRow, type SpotRow, type TripDoc } from "@/lib/model/types";
import { computeTripSchedule, spotsOfDay } from "@/lib/schedule/compute";
import { useTripSync } from "@/lib/realtime/sync";
import { getRouteProvider, type LatLng } from "@/lib/routing";
import { searchPlaces } from "@/lib/geo/geocode";
import { toTokyoHHMM } from "@/lib/datetime";
import type { PendingPin } from "./TripMap";
import SpotCard from "./SpotCard";
import SpotEditorModal from "./SpotEditorModal";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-neutral-100 flex items-center justify-center text-xs text-neutral-500">
      地図を読み込み中...
    </div>
  ),
});

interface TripWorkspaceProps {
  initialDoc: TripDoc;
}

export default function TripWorkspace({ initialDoc }: TripWorkspaceProps) {
  const [doc, setDoc] = useState<TripDoc>(initialDoc);
  const [activeDayIdx, setActiveDayIdx] = useState<number>(
    initialDoc.days.find((d) => d.day_index === 1)?.day_index ?? 0,
  );
  const [editingSpot, setEditingSpot] = useState<{ spot: SpotRow; isNew: boolean } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [depGeoBusy, setDepGeoBusy] = useState(false);

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

  const daySpots = useMemo(() => spotsOfDay(doc.spots, activeDay.day_index), [doc.spots, activeDay.day_index]);
  const schedule = useMemo(() => computeTripSchedule(doc.days, doc.spots), [doc.days, doc.spots]);
  const daySchedule = schedule.byDay.get(activeDay.day_index);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** 指定スポットの「1つ前の座標」（先頭なら出発地点の座標） */
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

  /** 並び替えや出発地点変更のあと、車/徒歩スポットの移動時間をOSRMで再計算する */
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
            const r = await getRouteProvider().route(prev, { lat: s.lat, lng: s.lng }, s.transport_mode);
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
        spots: [
          ...prev.spots.filter((x) => x.day_index !== day.day_index),
          ...updated,
        ],
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

    // 1. 楽観的更新で即座に全行程の時刻を再計算
    setDoc((prev) => ({
      ...prev,
      spots: [
        ...prev.spots.filter((s) => s.day_index !== activeDay.day_index),
        ...reordered,
      ],
    }));

    // 2. サーバーへ並び順を保存
    await fetch(`/api/trips/${tripId}/spots/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_index: activeDay.day_index,
        ordered_ids: reordered.map((s) => s.id),
      }),
    });
    notifyChange();

    // 3. 座標が揃っている車/徒歩区間の移動時間を自動再計算
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
    // 移動時間が未設定かつ車/徒歩で座標がある場合は自動計算を試みる
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
    setDoc((d) => ({ ...d, spots: d.spots.filter((x) => x.id !== spotId) }));
    await fetch(`/api/trips/${tripId}/spots/${spotId}`, { method: "DELETE" });
    notifyChange();
  }

  async function handleCopyShareUrl() {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  return (
    <div className="h-dvh flex flex-col bg-neutral-50 text-neutral-900 overflow-hidden">
      {/* ヘッダー */}
      <header className="px-3 py-2 bg-white border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-bold truncate">{doc.trip.title}</h1>
          <div className="text-[11px] text-neutral-500 flex items-center gap-2">
            {doc.trip.start_date && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {doc.trip.start_date}
                {doc.trip.end_date ? ` 〜 ${doc.trip.end_date}` : ""}
              </span>
            )}
            {schedule.conflicts.length > 0 && (
              <span className="inline-flex items-center gap-1 text-red-600 font-bold">
                <AlertTriangle className="w-3 h-3" />
                破綻 {schedule.conflicts.length}件
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyShareUrl}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-neutral-200 text-xs font-semibold hover:bg-neutral-100"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
            {copiedUrl ? "URLコピー済" : "共有URL"}
          </button>
        </div>
      </header>

      {/* 上部: インタラクティブ地図（モバイル最適比率） */}
      <div className="h-[38vh] min-h-[220px] max-h-[380px] w-full shrink-0 border-b border-neutral-200">
        <TripMap
          day={activeDay}
          spots={daySpots}
          onPickPlace={(pin) => openNewSpotModal(pin)}
          onSelectSpot={(spot) => setEditingSpot({ spot, isNew: false })}
        />
      </div>

      {/* 日程タブ（出発前 / Day 1 / Day 2 ...） */}
      <div className="bg-white border-b border-neutral-200 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {doc.days.map((d) => {
          const active = d.day_index === activeDay.day_index;
          const dayConflicts = schedule.byDay.get(d.day_index)?.conflicts.length ?? 0;
          return (
            <button
              key={d.day_index}
              type="button"
              onClick={() => setActiveDayIdx(d.day_index)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex items-center gap-1 ${
                active
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              <span>{d.label}</span>
              {d.date && (
                <span className={`text-[10px] font-normal ${active ? "text-blue-100" : "text-neutral-500"}`}>
                  ({d.date.slice(5)})
                </span>
              )}
              {dayConflicts > 0 && (
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="時刻超過あり" />
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleAddDay}
          className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-blue-600 hover:bg-blue-50 whitespace-nowrap"
        >
          ＋日程追加
        </button>
      </div>

      {/* 下部: タイムライン */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* 出発地点・出発時刻バー（Day 1 以降） */}
        {activeDay.day_index > 0 && (
          <div className="rounded-2xl bg-white border border-neutral-200 p-3 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                <span>出発設定（変更すると全行程の時刻を再計算）</span>
              </div>
              {daySpots.length > 0 && (
                <button
                  type="button"
                  disabled={recalcBusy}
                  onClick={() => recalculateDayRoutes(activeDay, daySpots)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-[11px] font-semibold text-neutral-700 disabled:opacity-50"
                >
                  <Calculator className="w-3 h-3" />
                  {recalcBusy ? "ルート計算中..." : "移動時間を一括再計算"}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-3 flex items-center gap-1.5">
                <span className="text-[11px] text-neutral-500 shrink-0">日付</span>
                <input
                  type="date"
                  value={activeDay.date ?? ""}
                  onChange={(e) => handleSaveDayPatch({ date: e.target.value || null })}
                  className="w-full px-2 py-1.5 rounded-lg border border-neutral-300 text-xs"
                />
              </div>

              <div className="sm:col-span-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span className="text-[11px] text-neutral-500 shrink-0">出発</span>
                <input
                  type="time"
                  value={activeDay.departure_time ?? ""}
                  onChange={(e) => handleSaveDayPatch({ departure_time: e.target.value || null })}
                  className="w-full px-2 py-1.5 rounded-lg border border-neutral-300 text-xs font-mono"
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
                  onBlur={(e) => handleSaveDayPatch({ departure_point: e.target.value || null })}
                  placeholder="出発地点（例: 自宅 / 新宿駅）"
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-neutral-300 text-xs"
                />
                <button
                  type="button"
                  disabled={depGeoBusy}
                  onClick={handleGeocodeDeparture}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 shrink-0"
                >
                  {depGeoBusy ? "..." : "座標取得"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* スポット一覧（ドラッグ＆ドロップ対応） */}
        {daySpots.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-6 text-center space-y-2">
            <p className="text-xs text-neutral-600">
              上の地図をタップするか検索してピンを立て、「しおりに追加」を押してください。
            </p>
            <button
              type="button"
              onClick={() => openNewSpotModal()}
              className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              地図を使わずにスポットを追加
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={daySpots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {daySpots.map((spot, idx) => (
                  <SpotCard
                    key={spot.id}
                    index={idx}
                    spot={spot}
                    timing={daySchedule?.timings[spot.id]}
                    onEdit={(s) => setEditingSpot({ spot: s, isNew: false })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* タイムライン末尾の到着時刻と追加ボタン */}
        <div className="flex items-center justify-between pt-1 pb-6">
          {daySchedule?.end ? (
            <span className="text-xs text-neutral-500 font-mono">
              全行程終了予定: {toTokyoHHMM(daySchedule.end)}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => openNewSpotModal()}
            className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-sm hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            スポットを追加
          </button>
        </div>
      </div>

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
    </div>
  );
}

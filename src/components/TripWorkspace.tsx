"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
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
  Calculator,
  Calendar,
  Sparkles,
  MapPin,
  Wallet,
  Backpack,
  Users,
  BedDouble,
  ListOrdered,
  Menu,
  X,
  Home,
  Pin,
  ArrowLeft,
  SlidersHorizontal,
} from "lucide-react";
import {
  addDays,
  daysBetween,
  initialDays,
  newSpot,
  type BelongingRow,
  type CostRow,
  type DayRow,
  type DishRow,
  type ParticipantRow,
  type SpotRow,
  type TripDoc,
} from "@/lib/model/types";
import { computeTripSchedule, spotsOfDay } from "@/lib/schedule/compute";
import { autoBuildEfficientItinerary } from "@/lib/schedule/auto-planner";
import { useTripSync } from "@/lib/realtime/sync";
import { estimateRouteFallback, getRouteProvider, type LatLng } from "@/lib/routing";
import { deserializeBusinessHours, parseOsmOpeningHours, serializeBusinessHours } from "@/lib/geo/business-hours";
import { geocodeSpot } from "@/lib/geo/geocode";
import { buildGoogleMapsNavUrl } from "@/lib/geo/nav";
import { toTokyoDate, toTokyoHHMM } from "@/lib/datetime";
import type { PendingPin } from "./TripMap";
import SpotCard from "./SpotCard";
import SpotEditorModal from "./SpotEditorModal";
import LegEditorModal from "./LegEditorModal";
import ParticipantsPanel from "./ParticipantsPanel";
import CostsPanel from "./CostsPanel";
import PrepAndDishesPanel from "./PrepAndDishesPanel";
import MuseExportModal from "./MuseExportModal";
import PasscodeGateModal from "./PasscodeGateModal";
import ShareTripModal from "./ShareTripModal";
import DepartureSettingsModal from "./DepartureSettingsModal";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-slate-100 flex items-center justify-center text-xs text-slate-500">
      地図を読み込み中...
    </div>
  ),
});

type MainTab = "itinerary" | "map" | "pool" | "costs" | "prep" | "members";

interface TripWorkspaceProps {
  initialDoc: TripDoc;
}

/** 「出発前」(day_index 0) を除外し、Day 1..N のみに正規化する */
function normalizeDays(doc: TripDoc): TripDoc {
  const filtered = doc.days.filter((d) => d.day_index >= 1);
  const days =
    filtered.length > 0
      ? filtered
      : initialDays(doc.trip.start_date, doc.trip.end_date);
  return { ...doc, days, photos: [] };
}

function readStoredTrip(base: TripDoc): TripDoc {
  if (typeof window === "undefined") return base;
  try {
    // 1. サーバー側（Supabase）に既にスポットや参加者等の実データがある場合はサーバーの最新状態を優先する
    const serverHasContent =
      base.spots.length > 0 ||
      base.participants.length > 0 ||
      base.costs.length > 0 ||
      base.belongings.length > 0 ||
      base.dishes.length > 0 ||
      (base.trip.title !== "新しい旅行しおり" && base.trip.title !== "");

    if (serverHasContent) {
      return base;
    }

    // 2. サーバーが空枠（Supabase未接続のMemoryStore別インスタンス等）の場合のみローカルキャッシュを復元
    const cached = localStorage.getItem(`voyage:doc:${base.trip.id}`);
    if (cached) {
      const parsed = JSON.parse(cached) as TripDoc;
      if (parsed?.trip?.id === base.trip.id) {
        return normalizeDays(parsed);
      }
    }

    // 3. トップ画面で新規作成した際のタイトル・開始日・終了日のメタ情報があれば反映
    const initMeta = localStorage.getItem(`voyage:init:${base.trip.id}`);
    if (initMeta) {
      const meta = JSON.parse(initMeta) as {
        title?: string;
        start_date?: string | null;
        end_date?: string | null;
      };
      const start = meta.start_date !== undefined ? meta.start_date : base.trip.start_date;
      const end = meta.end_date !== undefined ? meta.end_date : base.trip.end_date;
      return {
        ...base,
        trip: {
          ...base.trip,
          title: meta.title || base.trip.title,
          start_date: start,
          end_date: end,
        },
        days: initialDays(start, end),
      };
    }
  } catch {
    // ignore
  }
  return base;
}

export default function TripWorkspace({ initialDoc }: TripWorkspaceProps) {
  const [doc, setDoc] = useState<TripDoc>(() => readStoredTrip(normalizeDays(initialDoc)));

  // localStorage と「最近のしおり一覧」、およびサーバー側ストアへ自動保存・同期する
  useEffect(() => {
    try {
      if (window.location.hash.includes("s=")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      localStorage.setItem(`voyage:doc:${doc.trip.id}`, JSON.stringify(doc));
      const rawList = localStorage.getItem("voyage:recent_trips");
      const list: { id: string; title: string; start_date: string | null; end_date: string | null; updatedAt: number }[] =
        rawList ? JSON.parse(rawList) : [];
      const nextList = [
        {
          id: doc.trip.id,
          title: doc.trip.title,
          start_date: doc.trip.start_date,
          end_date: doc.trip.end_date,
          updatedAt: Date.now(),
        },
        ...list.filter((x) => x.id !== doc.trip.id),
      ].slice(0, 20);
      localStorage.setItem("voyage:recent_trips", JSON.stringify(nextList));
    } catch {
      // ignore quota errors
    }
    const timer = setTimeout(() => {
      void fetch(`/api/trips/${doc.trip.id}/sync`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [doc]);

  const [mainTab, setMainTab] = useState<MainTab>("itinerary");
  const [activeDayIdx, setActiveDayIdx] = useState<number>(1);
  const [editingSpot, setEditingSpot] = useState<{ spot: SpotRow; isNew: boolean } | null>(null);
  const [editingLeg, setEditingLeg] = useState<{
    spot: SpotRow;
    fromLabel: string;
    fromCoords: LatLng | null;
    routeFromKey: string;
  } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showDepartureModal, setShowDepartureModal] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const t0 = window.setTimeout(() => setNowMs(Date.now()), 0);
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, []);
  const [autoPlanBusy, setAutoPlanBusy] = useState(false);
  const [autoPlanMsg, setAutoPlanMsg] = useState<string | null>(null);
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
      // サーバーが MemoryStore の空枠を返した場合は、手元のデータが空でない限り上書きしない
      setDoc((prev) => {
        if (latest.spots.length === 0 && prev.spots.length > 0) return prev;
        return normalizeDays(latest);
      });
    }
  }, [tripId]);

  const { notifyChange } = useTripSync(tripId, fetchLatest);

  const activeDay: DayRow = useMemo(
    () =>
      doc.days.find((d) => d.day_index === activeDayIdx) ??
      doc.days[0] ?? {
        day_index: 1,
        label: "Day 1",
        date: doc.trip.start_date,
        departure_point: null,
        departure_lat: null,
        departure_lng: null,
        departure_time: "08:00",
      },
    [doc.days, activeDayIdx, doc.trip.start_date],
  );

  const poolSpots = useMemo(() => spotsOfDay(doc.spots, 0), [doc.spots]);
  const daySpots = useMemo(
    () => spotsOfDay(doc.spots, activeDay.day_index),
    [doc.spots, activeDay.day_index],
  );
  const schedule = useMemo(() => computeTripSchedule(doc.days, doc.spots), [doc.days, doc.spots]);
  const daySchedule = schedule.byDay.get(activeDay.day_index);
  const checkoutByDay = useMemo(() => {
    const m = new Map<number, SpotRow | null>();
    for (const d of doc.days) {
      m.set(d.day_index, schedule.byDay.get(d.day_index)?.checkoutSpot ?? null);
    }
    return m;
  }, [doc.days, schedule]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** 旅行全体の開始日・終了日を変更した際、Day 1..N の日付を連動して再設定する */
  async function handleChangeTripDates(newStart: string | null, newEnd: string | null) {
    const end = newStart && !newEnd ? newStart : newStart && newEnd && newEnd < newStart ? newStart : newEnd;
    const count =
      newStart && end ? Math.min(31, Math.max(1, daysBetween(newStart, end) + 1)) : doc.days.length;

    const nextDays: DayRow[] = [];
    for (let i = 1; i <= count; i++) {
      const existing = doc.days.find((d) => d.day_index === i);
      nextDays.push({
        day_index: i,
        label: `Day ${i}`,
        date: newStart ? addDays(newStart, i - 1) : existing?.date ?? null,
        departure_point: existing?.departure_point ?? null,
        departure_lat: existing?.departure_lat ?? null,
        departure_lng: existing?.departure_lng ?? null,
        departure_time: existing?.departure_time ?? "08:00",
      });
    }

    setDoc((prev) => ({
      ...prev,
      trip: { ...prev.trip, start_date: newStart, end_date: end },
      days: nextDays,
    }));
    if (activeDayIdx > count) setActiveDayIdx(count);

    await fetch(`/api/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: newStart, end_date: end }),
    });
    for (const d of nextDays) {
      await fetch(`/api/trips/${tripId}/days/${d.day_index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
    }
    notifyChange();
  }

  async function recalculateDayRoutes(day: DayRow, ordered: SpotRow[]) {
    setRecalcBusy(true);
    try {
      const co = schedule.byDay.get(day.day_index)?.checkoutSpot;
      const depLat = day.departure_lat ?? co?.lat ?? null;
      const depLng = day.departure_lng ?? co?.lng ?? null;

      // 1. まず即座に距離ベースの概算値で全区間を更新（前後ペアが変わった区間はデフォルト「車・高速あり」にリセット）
      const instant: SpotRow[] = ordered.map((s, i) => {
        const expectedFromKey = i === 0 ? `day:${day.day_index}` : `spot:${ordered[i - 1].id}`;
        const bh = deserializeBusinessHours(s.transport_note);
        const pairChanged = Boolean(bh.routeFromKey && bh.routeFromKey !== expectedFromKey);
        const effectiveMode = pairChanged ? "car" : (s.transport_mode ?? "car");
        const effectiveAvoidTolls = pairChanged ? false : Boolean(bh.avoidTolls);
        const nextNote = serializeBusinessHours({
          ...bh,
          avoidTolls: effectiveAvoidTolls,
          routeFromKey: expectedFromKey,
        });

        const prev: LatLng | null =
          i === 0
            ? depLat !== null && depLng !== null
              ? { lat: depLat, lng: depLng }
              : null
            : ordered[i - 1].lat !== null && ordered[i - 1].lng !== null
              ? { lat: ordered[i - 1].lat!, lng: ordered[i - 1].lng! }
              : null;

        const isRoutable =
          effectiveMode === "car" || effectiveMode === "walk" || effectiveMode === "train";
        if (prev && s.lat !== null && s.lng !== null && isRoutable) {
          const est = estimateRouteFallback(
            prev,
            { lat: s.lat, lng: s.lng },
            effectiveMode as "car" | "walk" | "train",
            effectiveMode === "car" && effectiveAvoidTolls,
          );
          return {
            ...s,
            sort_order: i,
            transport_mode: effectiveMode,
            transport_note: nextNote,
            transport_duration_minutes: est.duration_minutes,
            transport_distance_m: est.distance_m,
          };
        }
        if (isRoutable) {
          // 座標未確定の区間は前の並び順の古い距離を残さない
          return {
            ...s,
            sort_order: i,
            transport_mode: effectiveMode,
            transport_note: nextNote,
            transport_duration_minutes: null,
            transport_distance_m: null,
          };
        }
        return {
          ...s,
          sort_order: i,
          transport_mode: effectiveMode,
          transport_note: nextNote,
        };
      });

      setDoc((prev) => ({
        ...prev,
        spots: [...prev.spots.filter((x) => x.day_index !== day.day_index), ...instant],
      }));

      // 2. 続いて座標未設定スポットを補完しつつ、ルートAPIで精密な移動時間・距離を取得して保存
      const updated: SpotRow[] = [];
      for (let i = 0; i < instant.length; i++) {
        let s = instant[i];
        let latLngPatched = false;
        if ((s.lat === null || s.lng === null) && (s.address?.trim() || s.name.trim())) {
          try {
            const geo = await geocodeSpot(s.address, s.name);
            if (geo) {
              s = { ...s, lat: geo.lat, lng: geo.lng };
              latLngPatched = true;
            }
          } catch {
            // 座標取得失敗時はスキップ
          }
        }

        const prev: LatLng | null =
          i === 0
            ? depLat !== null && depLng !== null
              ? { lat: depLat, lng: depLng }
              : null
            : updated[i - 1].lat !== null && updated[i - 1].lng !== null
              ? { lat: updated[i - 1].lat!, lng: updated[i - 1].lng! }
              : null;

        const isRoutable =
          s.transport_mode === "car" || s.transport_mode === "walk" || s.transport_mode === "train";
        if (prev && s.lat !== null && s.lng !== null && isRoutable) {
          const avoidTolls =
            s.transport_mode === "car" && Boolean(deserializeBusinessHours(s.transport_note).avoidTolls);
          const r = await getRouteProvider().route(
            prev,
            { lat: s.lat, lng: s.lng },
            s.transport_mode as "car" | "walk" | "train",
            { avoidTolls },
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
              ...(latLngPatched ? { lat: s.lat, lng: s.lng } : {}),
              transport_mode: nextSpot.transport_mode,
              transport_note: nextSpot.transport_note,
              transport_duration_minutes: r.duration_minutes,
              transport_distance_m: r.distance_m,
            }),
          });
        } else {
          updated.push(s);
          const orig = ordered[i];
          const metaChanged =
            orig.transport_mode !== s.transport_mode || orig.transport_note !== s.transport_note;
          const hadStale =
            isRoutable &&
            (orig.transport_duration_minutes !== null || orig.transport_distance_m !== null);
          if (latLngPatched || hadStale || metaChanged) {
            await fetch(`/api/trips/${tripId}/spots/${s.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(latLngPatched ? { lat: s.lat, lng: s.lng } : {}),
                transport_mode: s.transport_mode,
                transport_note: s.transport_note,
                ...(hadStale
                  ? { transport_duration_minutes: null, transport_distance_m: null }
                  : {}),
              }),
            });
          }
        }
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

  /**
   * 優先度（★メイン・決まった・候補・未定）・営業時間・定休日・宿泊チェックイン時刻・移動距離を考慮して
   * 全スポット（候補プール＋各Day）を自動的に最適な順番・日程へ編成する
   */
  async function handleAutoPlanItinerary() {
    if (doc.spots.length === 0) return;
    setAutoPlanBusy(true);
    setAutoPlanMsg(null);
    try {
      const { spots: optimized, summary } = await autoBuildEfficientItinerary(
        doc.days,
        doc.spots,
        true,
      );
      const nextDoc: TripDoc = { ...doc, spots: optimized };
      setDoc(nextDoc);
      setAutoPlanMsg(summary.message);
      if (mainTab === "pool" && summary.scheduledCount > 0) {
        setMainTab("itinerary");
      }
      await fetch(`/api/trips/${tripId}/sync`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextDoc),
      });
      notifyChange();
    } finally {
      setAutoPlanBusy(false);
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

  async function handleAddDay() {
    const maxIdx = Math.max(0, ...doc.days.map((d) => d.day_index));
    const nextIdx = maxIdx + 1;
    const prevDate = doc.days.find((d) => d.day_index === maxIdx)?.date ?? doc.trip.start_date;
    const nextDate = prevDate ? addDays(prevDate, 1) : null;
    const newDay: DayRow = {
      day_index: nextIdx,
      label: `Day ${nextIdx}`,
      date: nextDate,
      departure_point: null,
      departure_lat: null,
      departure_lng: null,
      departure_time: "08:00",
    };
    setDoc((prev) => ({
      ...prev,
      trip: { ...prev.trip, end_date: nextDate ?? prev.trip.end_date },
      days: [...prev.days, newDay],
    }));
    setActiveDayIdx(nextIdx);
    await fetch(`/api/trips/${tripId}/days/${nextIdx}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newDay),
    });
    notifyChange();
  }

  function openNewSpotModal(pin?: PendingPin, forceDayIndex?: number) {
    const bhNote = pin?.opening_hours
      ? serializeBusinessHours(parseOsmOpeningHours(pin.opening_hours))
      : "";
    const targetDayIdx =
      forceDayIndex !== undefined ? forceDayIndex : mainTab === "pool" ? 0 : activeDay.day_index;
    const targetList = targetDayIdx === 0 ? poolSpots : daySpots;
    const draft = newSpot({
      id: crypto.randomUUID(),
      day_index: targetDayIdx,
      sort_order: targetList.length,
      name: pin?.name ?? "",
      address: pin?.address ?? null,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
      place_url: pin ? `https://maps.google.com/?q=${pin.lat},${pin.lng}` : null,
      transport_mode: "car",
      transport_note: bhNote,
    });
    setEditingSpot({ spot: draft, isNew: true });
  }

  async function handleSaveSpot(spot: SpotRow) {
    let finalSpot = spot;
    const targetDay = doc.days.find((d) => d.day_index === spot.day_index) ?? activeDay;
    const targetDaySpots = spotsOfDay(doc.spots, targetDay.day_index);
    const targetCo = checkoutByDay.get(targetDay.day_index) ?? null;
    const isSameDay = !editingSpot?.isNew && editingSpot?.spot.day_index === spot.day_index;
    const idxInTarget = isSameDay
      ? targetDaySpots.findIndex((s) => s.id === spot.id)
      : targetDaySpots.length;
    const prevSpot = idxInTarget > 0 ? targetDaySpots[idxInTarget - 1] : null;
    const prev: LatLng | null = prevSpot
      ? prevSpot.lat !== null && prevSpot.lng !== null
        ? { lat: prevSpot.lat, lng: prevSpot.lng }
        : null
      : targetDay.departure_lat !== null && targetDay.departure_lng !== null
        ? { lat: targetDay.departure_lat, lng: targetDay.departure_lng }
        : targetCo && targetCo.lat !== null && targetCo.lng !== null
          ? { lat: targetCo.lat, lng: targetCo.lng }
          : null;
    if (
      finalSpot.transport_duration_minutes === null &&
      prev &&
      finalSpot.lat !== null &&
      finalSpot.lng !== null &&
      (finalSpot.transport_mode === "car" ||
        finalSpot.transport_mode === "walk" ||
        finalSpot.transport_mode === "train")
    ) {
      try {
        const avoidTolls =
          finalSpot.transport_mode === "car" &&
          Boolean(deserializeBusinessHours(finalSpot.transport_note).avoidTolls);
        const r = await getRouteProvider().route(
          prev,
          { lat: finalSpot.lat, lng: finalSpot.lng },
          finalSpot.transport_mode,
          { avoidTolls },
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
      const nextSpotsList = [...doc.spots, finalSpot];
      setDoc((d) => ({ ...d, spots: nextSpotsList }));
      if (finalSpot.day_index === 0) {
        setMainTab("pool");
      } else if (finalSpot.day_index !== activeDayIdx) {
        setActiveDayIdx(finalSpot.day_index);
      }
      await fetch(`/api/trips/${tripId}/spots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalSpot),
      });
      if (finalSpot.day_index >= 1) {
        void recalculateDayRoutes(targetDay, spotsOfDay(nextSpotsList, finalSpot.day_index));
      }
    } else {
      const nextSpotsList = doc.spots.map((x) => (x.id === finalSpot.id ? finalSpot : x));
      setDoc((d) => ({ ...d, spots: nextSpotsList }));
      if (finalSpot.day_index === 0 && editingSpot?.spot.day_index !== 0) {
        setMainTab("pool");
      } else if (finalSpot.day_index >= 1 && finalSpot.day_index !== activeDayIdx) {
        setActiveDayIdx(finalSpot.day_index);
      }
      await fetch(`/api/trips/${tripId}/spots/${finalSpot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalSpot),
      });
      // 情報や日程が変わった際もその日の全区間の距離・時間を自動再計算する
      if (finalSpot.day_index >= 1) {
        void recalculateDayRoutes(targetDay, spotsOfDay(nextSpotsList, finalSpot.day_index));
      }
      const prevDayIdx = editingSpot?.spot.day_index;
      if (prevDayIdx && prevDayIdx >= 1 && prevDayIdx !== finalSpot.day_index) {
        const oldDay = doc.days.find((d) => d.day_index === prevDayIdx);
        if (oldDay) {
          void recalculateDayRoutes(oldDay, spotsOfDay(nextSpotsList, prevDayIdx));
        }
      }
    }

    // 宿泊スポットでチェックアウト日時が設定されている場合、該当する翌日（チェックアウト日）の出発設定を宿泊地座標＆チェックアウト時刻で自動更新する
    if (finalSpot.category === "lodging" && finalSpot.check_out) {
      const coDate = toTokyoDate(new Date(finalSpot.check_out));
      const coHHMM = toTokyoHHMM(finalSpot.check_out);
      const checkoutDay = doc.days.find(
        (d) => d.date === coDate && d.day_index !== finalSpot.day_index,
      );
      if (checkoutDay) {
        const patchedDay: DayRow = {
          ...checkoutDay,
          departure_point: finalSpot.name,
          departure_lat: finalSpot.lat,
          departure_lng: finalSpot.lng,
          departure_time: coHHMM,
        };
        setDoc((prev) => ({
          ...prev,
          days: prev.days.map((d) =>
            d.day_index === checkoutDay.day_index ? patchedDay : d,
          ),
        }));
        await fetch(`/api/trips/${tripId}/days/${checkoutDay.day_index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchedDay),
        });
        const nextDaySpots = spotsOfDay(doc.spots, checkoutDay.day_index);
        if (nextDaySpots.length > 0) {
          void recalculateDayRoutes(patchedDay, nextDaySpots);
        }
      }
    }

    notifyChange();
  }

  async function handleDeleteSpot(spotId: string) {
    const target = doc.spots.find((x) => x.id === spotId);
    const nextSpotsList = doc.spots.filter((x) => x.id !== spotId);
    setDoc((d) => ({
      ...d,
      spots: nextSpotsList,
    }));
    await fetch(`/api/trips/${tripId}/spots/${spotId}`, { method: "DELETE" });
    if (target && target.day_index >= 1) {
      const targetDay = doc.days.find((d) => d.day_index === target.day_index);
      if (targetDay) {
        void recalculateDayRoutes(targetDay, spotsOfDay(nextSpotsList, target.day_index));
      }
    }
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

      {/* iOS Voyage 風グラスモーフィズムヘッダー（タイトル・日程変更対応） */}
      <header className="relative z-[1200] px-3.5 py-2 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={doc.trip.title}
            onChange={(e) =>
              setDoc((prev) => ({ ...prev, trip: { ...prev.trip, title: e.target.value } }))
            }
            onBlur={async (e) => {
              const title = e.target.value.trim() || "無題の旅行";
              await fetch(`/api/trips/${tripId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              });
              notifyChange();
            }}
            className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none w-full max-w-xs truncate"
          />
          <div className="text-[11px] text-slate-500 flex items-center flex-wrap gap-1.5 mt-0.5">
            <Calendar className="w-3 h-3 text-blue-600 shrink-0" />
            <input
              type="date"
              value={doc.trip.start_date ?? ""}
              onChange={(e) => handleChangeTripDates(e.target.value || null, doc.trip.end_date)}
              className="bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-700"
            />
            <span>〜</span>
            <input
              type="date"
              min={doc.trip.start_date || undefined}
              value={doc.trip.end_date ?? ""}
              onChange={(e) => handleChangeTripDates(doc.trip.start_date, e.target.value || null)}
              className="bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-700"
            />
            {schedule.conflicts.length > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-red-100 text-red-700 font-bold">
                <AlertTriangle className="w-3 h-3" />
                破綻 {schedule.conflicts.length}件
              </span>
            )}
          </div>
        </div>

        {/* 右上アクション（しおり共有・Muse出力などはサイドバーメニューに集約してスッキリ表示） */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowSidebar(true)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 shadow-2xs cursor-pointer"
            aria-label="メニューを開く"
            title="共有・Muse出力・メニュー"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 日程セグメントピルタブ（タイムスケジュール・マップ表示時のみ、Day 1 / Day 2 ... だけをシンプルに横並び） */}
      {(mainTab === "itinerary" || mainTab === "map") && (
        <div className="bg-white px-3.5 py-2 border-b border-slate-200/80 shrink-0 z-10 space-y-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {doc.days.map((d) => {
              const active = d.day_index === activeDay.day_index;
              const dayConflicts = schedule.byDay.get(d.day_index)?.conflicts.length ?? 0;
              return (
                <button
                  key={d.day_index}
                  type="button"
                  onClick={() => setActiveDayIdx(d.day_index)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1 shrink-0 ${
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
              className="px-3 py-1.5 rounded-full text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 whitespace-nowrap shrink-0"
              title="日程を追加"
            >
              ＋日程
            </button>
          </div>

          {autoPlanMsg && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-950">
              <span>{autoPlanMsg}</span>
              <button
                type="button"
                onClick={() => setAutoPlanMsg(null)}
                className="text-indigo-500 hover:text-indigo-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 費用・準備・参加者ビュー表示時の上部タイトルバー（ワンタップで旅程へ戻れる） */}
      {(mainTab === "costs" || mainTab === "prep" || mainTab === "members") && (
        <div className="bg-white px-3.5 py-2 border-b border-slate-200/80 flex items-center justify-between shrink-0 z-10">
          <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
            {mainTab === "costs" && (
              <>
                <Wallet className="w-4 h-4 text-blue-600" />
                <span>費用・精算管理（{doc.costs.length}件）</span>
              </>
            )}
            {mainTab === "prep" && (
              <>
                <Backpack className="w-4 h-4 text-blue-600" />
                <span>準備（持ち物 {doc.belongings.length} / 料理 {doc.dishes.length}）</span>
              </>
            )}
            {mainTab === "members" && (
              <>
                <Users className="w-4 h-4 text-blue-600" />
                <span>参加者・全体メモ（{doc.participants.length}名）</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMainTab("itinerary")}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>旅程へ戻る</span>
          </button>
        </div>
      )}

      {/* メインコンテンツ（タブに応じてフルスクリーンで切替） */}
      {mainTab === "map" ? (
        <div className="flex-1 w-full min-h-0 relative">
          <TripMap
            day={activeDay}
            spots={daySpots}
            timings={daySchedule?.timings}
            checkoutSpot={daySchedule?.checkoutSpot}
            onPickPlace={(pin) => openNewSpotModal(pin)}
            onSelectSpot={(spot) => setEditingSpot({ spot, isNew: false })}
          />
        </div>
      ) : mainTab === "pool" ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 max-w-3xl w-full mx-auto">
          <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200 p-3.5 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                <Pin className="w-4 h-4 text-indigo-600" />
                <span>候補プール（日程未定ストック：{poolSpots.length}件）</span>
              </div>
              {doc.spots.length > 0 && (
                <button
                  type="button"
                  disabled={autoPlanBusy}
                  onClick={handleAutoPlanItinerary}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-extrabold shadow-xs hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{autoPlanBusy ? "自動編成中..." : "効率ルート自動編成"}</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-indigo-900 leading-relaxed">
              行きたい場所をとりあえずここに追加し、優先度（<strong>★メイン / 決まった / 候補 / 未定</strong>）や<strong>🎯枠タグ（1日目昼食・2日目温泉など）</strong>を設定して「効率ルート自動編成」を押すと、営業時間・定休日・移動時間を考慮して各Dayへ自動配置します。
            </p>
          </div>

          {poolSpots.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-6 text-center space-y-3">
              <p className="text-xs text-slate-600">
                現在、候補プールに入っているスポットはありません。
              </p>
              <button
                type="button"
                onClick={() => openNewSpotModal(undefined, 0)}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-xs hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                候補プールにスポットを追加
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {poolSpots.map((spot, idx) => (
                <SpotCard
                  key={spot.id}
                  index={idx}
                  spot={spot}
                  dayDate={null}
                  timing={undefined}
                  onEdit={(s) => setEditingSpot({ spot: s, isNew: false })}
                />
              ))}
            </div>
          )}

          <div className="flex justify-end pt-1 pb-6">
            <button
              type="button"
              onClick={() => openNewSpotModal(undefined, 0)}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-2xl bg-indigo-600 text-white text-xs font-extrabold shadow-sm hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" />
              候補プールに追加
            </button>
          </div>
        </div>
      ) : mainTab === "itinerary" ? (
        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3 max-w-3xl w-full mx-auto">
          {/* 出発設定は普段は1行のコンパクトサマリーバーにして、タイムスケジュールを広く表示する */}
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-white border border-slate-200/90 px-3 py-2 shadow-2xs">
            <button
              type="button"
              onClick={() => setShowDepartureModal(true)}
              className="flex-1 min-w-0 flex items-center gap-2 text-left"
            >
              <span className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Navigation className="w-3.5 h-3.5" />
              </span>
              <div className="min-w-0 flex items-center gap-1.5 flex-wrap text-xs">
                <span className="font-mono font-extrabold text-slate-900">
                  {activeDay.departure_time ??
                    (daySchedule?.checkoutSpot?.check_out
                      ? toTokyoHHMM(daySchedule.checkoutSpot.check_out)
                      : "--:--")}
                </span>
                <span className="text-slate-400">出発</span>
                <span className="font-bold text-slate-700 truncate max-w-[160px]">
                  {activeDay.departure_point ||
                    daySchedule?.checkoutSpot?.name ||
                    "出発地点未設定"}
                </span>
                {daySchedule?.checkoutSpot && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                    🏨 宿泊連動
                  </span>
                )}
                {daySpots[0] && daySchedule?.timings[daySpots[0].id]?.must_leave_prev_by && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200"
                    title={daySchedule.timings[daySpots[0].id]?.leave_by_reason ?? undefined}
                  >
                    🕒 {daySchedule.timings[daySpots[0].id]?.must_leave_prev_by} までに出発
                  </span>
                )}
              </div>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              {daySpots.length > 0 && (
                <button
                  type="button"
                  disabled={recalcBusy}
                  onClick={() => recalculateDayRoutes(activeDay, daySpots)}
                  className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 disabled:opacity-50"
                  title="移動時間を再計算"
                >
                  <Calculator className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDepartureModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700"
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>出発設定</span>
              </button>
            </div>
          </div>

          {/* ワンタップ道案内（現在地 → 次の目的地） */}
          {(() => {
            if (daySpots.length === 0) return null;
            const nextSpot =
              (nowMs !== null
                ? daySpots.find((s) => {
                    const t = daySchedule?.timings[s.id];
                    const ref = t?.departure ?? t?.arrival;
                    return ref ? Date.parse(ref) > nowMs : false;
                  })
                : undefined) ?? daySpots[0];
            const navUrl = nextSpot ? buildGoogleMapsNavUrl(nextSpot) : null;
            if (!navUrl || !nextSpot) return null;
            return (
              <a
                href={navUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-2.5 shadow-sm transition active:scale-[0.99]"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <Navigation className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-bold truncate">
                    現在地から次へナビ：{nextSpot.name}
                  </span>
                </div>
                <span className="text-[11px] font-bold bg-white/20 px-2 py-0.5 rounded-full shrink-0">
                  Googleマップ ↗
                </span>
              </a>
            );
          })()}

          {/* 前日からの宿泊チェックアウト表示（日跨ぎ宿泊がある場合、チェックアウト日の先頭に自動表示） */}
          {daySchedule?.checkoutSpot && (
            <div className="grid grid-cols-[54px_20px_1fr] items-stretch gap-x-1">
              <div className="flex flex-col justify-center py-2 pr-1 text-right font-mono">
                <span className="text-xs font-extrabold text-purple-800">
                  {daySchedule.checkoutSpot.check_out
                    ? toTokyoHHMM(daySchedule.checkoutSpot.check_out)
                    : "--:--"}
                </span>
                <span className="text-[10px] text-purple-500 font-bold">OUT</span>
              </div>
              <div className="relative flex flex-col items-center">
                <div className="w-0.5 flex-1 bg-purple-200" />
                <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center ring-4 ring-purple-100 shadow-xs shrink-0">
                  <BedDouble className="w-3.5 h-3.5" />
                </div>
                <div className="w-0.5 flex-1 bg-slate-200" />
              </div>
              <div className="py-1 pl-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() =>
                    setEditingSpot({ spot: daySchedule.checkoutSpot!, isNew: false })
                  }
                  className="w-full text-left rounded-2xl border border-purple-200 bg-purple-50/70 p-3 shadow-2xs hover:bg-purple-50 transition space-y-1"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-600 text-white">
                      チェックアウト
                    </span>
                    <span className="text-[11px] font-semibold text-purple-800">
                      前日からの宿泊（タップで編集）
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-900 truncate">
                    {daySchedule.checkoutSpot.name}
                  </div>
                  {daySchedule.checkoutSpot.address && (
                    <div className="flex items-center gap-1 text-xs text-slate-500 truncate">
                      <MapPin className="w-3 h-3 shrink-0 text-purple-400" />
                      <span className="truncate">{daySchedule.checkoutSpot.address}</span>
                    </div>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* スポット一覧（Voyage風クロノグラフ軸 + D&D） */}
          {daySpots.length === 0 && !daySchedule?.checkoutSpot ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-6 text-center space-y-3">
              <p className="text-xs text-slate-600">
                まだスポットがありません。直接追加するか、「マップ」タブから場所を検索・タップしてピン留めできます。
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => openNewSpotModal()}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-xs hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" />
                  スポットを直接追加
                </button>
                <button
                  type="button"
                  onClick={() => setMainTab("map")}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold shadow-xs hover:bg-slate-800"
                >
                  <MapPin className="w-4 h-4" />
                  マップからピン留め追加
                </button>
              </div>
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
                      dayDate={activeDay.date}
                      timing={daySchedule?.timings[spot.id]}
                      onEdit={(s) => setEditingSpot({ spot: s, isNew: false })}
                      onEditLeg={(s) => {
                        const prevSpot = idx > 0 ? daySpots[idx - 1] : null;
                        const co = daySchedule?.checkoutSpot ?? null;
                        const fromLabel = prevSpot
                          ? prevSpot.name
                          : activeDay.departure_point || co?.name || "出発地";
                        const fromCoords: LatLng | null = prevSpot
                          ? prevSpot.lat !== null && prevSpot.lng !== null
                            ? { lat: prevSpot.lat, lng: prevSpot.lng }
                            : null
                          : activeDay.departure_lat !== null && activeDay.departure_lng !== null
                            ? { lat: activeDay.departure_lat, lng: activeDay.departure_lng }
                            : co && co.lat !== null && co.lng !== null
                              ? { lat: co.lat, lng: co.lng }
                              : null;
                        const routeFromKey = prevSpot
                          ? `spot:${prevSpot.id}`
                          : `day:${activeDay.day_index}`;
                        setEditingLeg({
                          spot: s,
                          fromLabel,
                          fromCoords,
                          routeFromKey,
                        });
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div className="flex items-center justify-between pt-1 pb-6">
            {daySchedule?.end ? (
              <span className="text-xs text-slate-500 font-mono font-bold">
                🏁 全行程終了予定: {toTokyoHHMM(daySchedule.end)}
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMainTab("map")}
                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-2xl border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50"
              >
                <MapPin className="w-3.5 h-3.5 text-blue-600" />
                マップで追加
              </button>
              <button
                type="button"
                onClick={() => openNewSpotModal()}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-2xl bg-blue-600 text-white text-xs font-extrabold shadow-sm hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                スポットを追加
              </button>
            </div>
          </div>
        </div>
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

      {/* 下部ナビバー：旅程の3ビュー（タイムスケジュール / マップ / 候補プール）だけに特化してスッキリ表示 */}
      <nav className="bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-1.5 grid grid-cols-3 gap-2 shrink-0 z-20">
        <button
          type="button"
          onClick={() => setMainTab("itinerary")}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            mainTab === "itinerary"
              ? "text-blue-600 font-extrabold bg-blue-50/70"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span className="text-[11px] mt-0.5">タイムスケジュール</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("map")}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            mainTab === "map"
              ? "text-blue-600 font-extrabold bg-blue-50/70"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span className="text-[11px] mt-0.5">マップ</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("pool")}
          className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
            mainTab === "pool"
              ? "text-indigo-600 font-extrabold bg-indigo-50/70"
              : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Pin className="w-4 h-4" />
          <span className="text-[11px] mt-0.5">候補プール({poolSpots.length})</span>
        </button>
      </nav>

      {/* スポット追加・編集モーダル */}
      {editingSpot && (
        <SpotEditorModal
          days={doc.days}
          allSpots={doc.spots}
          checkoutByDay={checkoutByDay}
          initial={editingSpot.spot}
          isNew={editingSpot.isNew}
          onSave={handleSaveSpot}
          onDelete={handleDeleteSpot}
          onClose={() => setEditingSpot(null)}
        />
      )}

      {/* 移動区間の編集モーダル（スポット間の移動ピルをタップで開く） */}
      {editingLeg && (
        <LegEditorModal
          fromLabel={editingLeg.fromLabel}
          fromCoords={editingLeg.fromCoords}
          toSpot={editingLeg.spot}
          routeFromKey={editingLeg.routeFromKey}
          onClose={() => setEditingLeg(null)}
          onSave={async (updatedSpot) => {
            const nextSpotsList = doc.spots.map((x) =>
              x.id === updatedSpot.id ? updatedSpot : x,
            );
            setDoc((d) => ({ ...d, spots: nextSpotsList }));
            await fetch(`/api/trips/${tripId}/spots/${updatedSpot.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: updatedSpot.lat,
                lng: updatedSpot.lng,
                transport_mode: updatedSpot.transport_mode,
                transport_duration_minutes: updatedSpot.transport_duration_minutes,
                transport_distance_m: updatedSpot.transport_distance_m,
                transport_note: updatedSpot.transport_note,
              }),
            });
            notifyChange();
          }}
        />
      )}

      {/* Muse連携エクスポートモーダル */}
      {showExportModal && (
        <MuseExportModal doc={doc} onClose={() => setShowExportModal(false)} />
      )}

      {/* しおり共有モーダル */}
      {showShareModal && (
        <ShareTripModal doc={doc} onClose={() => setShowShareModal(false)} />
      )}

      {/* 出発設定モーダル（タイムスケジュール画面を広く保つため、タップ時のみ開く） */}
      {showDepartureModal && (
        <DepartureSettingsModal
          day={activeDay}
          daySpotsCount={daySpots.length}
          checkoutSpot={daySchedule?.checkoutSpot ?? null}
          recalcBusy={recalcBusy}
          onSaveDay={handleSaveDayPatch}
          onRecalcRoutes={(overrideDay) =>
            recalculateDayRoutes(overrideDay ?? activeDay, daySpots)
          }
          onClose={() => setShowDepartureModal(false)}
        />
      )}

      {/* 右側スライドメニュー（サイドバー：共有・Muse出力・ホーム移動をここに収納） */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-[2400] bg-slate-900/50 backdrop-blur-xs flex justify-end"
          onClick={() => setShowSidebar(false)}
        >
          <aside
            className="w-72 max-w-[82vw] h-full bg-white shadow-2xl border-l border-slate-200 p-4 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <div className="text-xs font-extrabold text-slate-900 truncate max-w-[180px]">
                    {doc.trip.title || "旅行しおり"}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]">
                    ID: {doc.trip.id}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSidebar(false)}
                  className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 1. メインビュー切替（旅程 / 費用 / 準備 / 参加者） */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-extrabold text-slate-400 px-1">
                  画面切り替え
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMainTab("itinerary");
                    setShowSidebar(false);
                  }}
                  className={`w-full px-3 py-2.5 rounded-2xl border text-left flex items-center gap-3 transition ${
                    mainTab === "itinerary" || mainTab === "map" || mainTab === "pool"
                      ? "border-blue-300 bg-blue-50/80"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                    <ListOrdered className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">旅程・マップ・候補</div>
                    <div className="text-[10px] text-slate-500">
                      スケジュール ({doc.spots.length}件)
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMainTab("costs");
                    setShowSidebar(false);
                  }}
                  className={`w-full px-3 py-2.5 rounded-2xl border text-left flex items-center gap-3 transition ${
                    mainTab === "costs"
                      ? "border-blue-300 bg-blue-50/80"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      費用・精算 ({doc.costs.length})
                    </div>
                    <div className="text-[10px] text-slate-500">支払総額・個人別内訳の登録</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMainTab("prep");
                    setShowSidebar(false);
                  }}
                  className={`w-full px-3 py-2.5 rounded-2xl border text-left flex items-center gap-3 transition ${
                    mainTab === "prep"
                      ? "border-blue-300 bg-blue-50/80"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
                    <Backpack className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      準備（持ち物・料理）({doc.belongings.length + doc.dishes.length})
                    </div>
                    <div className="text-[10px] text-slate-500">持ち物チェック・料理と材料</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMainTab("members");
                    setShowSidebar(false);
                  }}
                  className={`w-full px-3 py-2.5 rounded-2xl border text-left flex items-center gap-3 transition ${
                    mainTab === "members"
                      ? "border-blue-300 bg-blue-50/80"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      参加者・全体メモ ({doc.participants.length})
                    </div>
                    <div className="text-[10px] text-slate-500">メンバー本名・ニックネーム</div>
                  </div>
                </button>
              </div>

              {/* 2. 共有・Muse出力 */}
              <div className="space-y-1.5 pt-2 border-t border-slate-200">
                <div className="text-[10px] font-extrabold text-slate-400 px-1">
                  共有・AI連携
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowSidebar(false);
                    setShowShareModal(true);
                  }}
                  className="w-full px-3 py-2.5 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-blue-50/70 text-left flex items-center gap-3 transition"
                >
                  <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">しおりを友人に共有</div>
                    <div className="text-[10px] text-slate-500">URL・部屋IDをコピーして招待</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowSidebar(false);
                    setShowExportModal(true);
                  }}
                  className="w-full px-3 py-2.5 rounded-2xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 text-left flex items-center gap-3 transition"
                >
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-indigo-950">
                      Muse連携用データを出力
                    </div>
                    <div className="text-[10px] text-indigo-700">
                      JSON・Markdown・サマリーURL
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <Link
                href="/"
                className="w-full px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                <span>トップ画面（しおり一覧）へ戻る</span>
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

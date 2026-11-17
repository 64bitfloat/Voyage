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
  Clock,
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
  Link2,
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
import { getRouteProvider, type LatLng } from "@/lib/routing";
import { searchPlaces } from "@/lib/geo/geocode";
import { parseOsmOpeningHours, serializeBusinessHours } from "@/lib/geo/business-hours";
import { toTokyoDate, toTokyoHHMM } from "@/lib/datetime";
import type { PendingPin } from "./TripMap";
import SpotCard from "./SpotCard";
import SpotEditorModal from "./SpotEditorModal";
import ParticipantsPanel from "./ParticipantsPanel";
import CostsPanel from "./CostsPanel";
import PrepAndDishesPanel from "./PrepAndDishesPanel";
import MuseExportModal from "./MuseExportModal";
import PasscodeGateModal from "./PasscodeGateModal";
import ShareTripModal from "./ShareTripModal";

const TripMap = dynamic(() => import("./TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-slate-100 flex items-center justify-center text-xs text-slate-500">
      地図を読み込み中...
    </div>
  ),
});

type MainTab = "itinerary" | "map" | "costs" | "prep" | "members";

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
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [autoPlanBusy, setAutoPlanBusy] = useState(false);
  const [autoPlanMsg, setAutoPlanMsg] = useState<string | null>(null);
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
      activeDayIdx === 0
        ? {
            day_index: 0,
            label: "候補プール",
            date: null,
            departure_point: null,
            departure_lat: null,
            departure_lng: null,
            departure_time: null,
          }
        : doc.days.find((d) => d.day_index === activeDayIdx) ??
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
      const updated: SpotRow[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const s = ordered[i];
        const prev: LatLng | null =
          i === 0
            ? day.departure_lat !== null && day.departure_lng !== null
              ? { lat: day.departure_lat, lng: day.departure_lng }
              : co && co.lat !== null && co.lng !== null
                ? { lat: co.lat, lng: co.lng }
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
      if (activeDayIdx === 0 && summary.scheduledCount > 0) {
        setActiveDayIdx(1);
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

  function openNewSpotModal(pin?: PendingPin) {
    const bhNote = pin?.opening_hours
      ? serializeBusinessHours(parseOsmOpeningHours(pin.opening_hours))
      : "";
    const draft = newSpot({
      id: crypto.randomUUID(),
      day_index: activeDay.day_index,
      sort_order: daySpots.length,
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
    const prev: LatLng | null =
      prevSpot && prevSpot.lat !== null && prevSpot.lng !== null
        ? { lat: prevSpot.lat, lng: prevSpot.lng }
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
      if (finalSpot.day_index !== activeDayIdx) {
        setActiveDayIdx(finalSpot.day_index);
      }
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
      if (finalSpot.day_index !== activeDayIdx) {
        setActiveDayIdx(finalSpot.day_index);
      }
      await fetch(`/api/trips/${tripId}/spots/${finalSpot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalSpot),
      });
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
    setDoc((d) => ({
      ...d,
      spots: d.spots.filter((x) => x.id !== spotId),
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

      {/* 日程セグメントピルタブ（Day 1 / Day 2 ... / 📌候補 のみシンプルに横並び） */}
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

            {/* 📌 候補プール（日程未定ストック）タブ */}
            <button
              type="button"
              onClick={() => setActiveDayIdx(0)}
              className={`px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition flex items-center gap-1 shrink-0 ${
                activeDay.day_index === 0
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
              }`}
            >
              <span>📌 候補</span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  activeDay.day_index === 0
                    ? "bg-white/20 text-white"
                    : "bg-indigo-200/70 text-indigo-900"
                }`}
              >
                {poolSpots.length}
              </span>
            </button>

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

      {/* メインコンテンツ（タブに応じてフルスクリーンで切替） */}
      {mainTab === "map" ? (
        <div className="flex-1 w-full min-h-0 relative">
          <TripMap
            day={activeDay}
            spots={daySpots}
            checkoutSpot={daySchedule?.checkoutSpot}
            onPickPlace={(pin) => openNewSpotModal(pin)}
            onSelectSpot={(spot) => setEditingSpot({ spot, isNew: false })}
          />
        </div>
      ) : mainTab === "itinerary" ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 max-w-3xl w-full mx-auto">
          {/* 候補プール選択時のガイドカード or Day 1..N の出発設定カード */}
          {activeDay.day_index === 0 ? (
            <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200 p-3.5 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs font-extrabold text-indigo-950">
                  📌 候補プール（まだ何日目に行くか決めていない場所ストック）
                </div>
                {doc.spots.length > 0 && (
                  <button
                    type="button"
                    disabled={autoPlanBusy}
                    onClick={handleAutoPlanItinerary}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-xs hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{autoPlanBusy ? "自動編成中..." : "優先度＆移動効率でDay1〜へ自動振り分け"}</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-indigo-900 leading-relaxed">
                行きたい場所をとりあえずここに追加しておき、優先度（<strong>★メイン / 決まった / 候補 / 未定</strong>）を選んでから上の「自動振り分け（効率ルート自動編成）」を押すと、営業時間・定休日・宿泊先・移動距離を計算して最適な日程と順番に自動で組み込みます！
              </p>
            </div>
          ) : (
          <div className="rounded-2xl bg-white border border-slate-200/90 p-3 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800 flex-wrap">
                <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                <span>{activeDay.label} の出発設定</span>
                {daySchedule?.checkoutSpot && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                    🏨 宿泊地「{daySchedule.checkoutSpot.name}」の座標・チェックアウト時刻と自動連動中
                  </span>
                )}
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
                  value={
                    activeDay.departure_time ??
                    (daySchedule?.checkoutSpot?.check_out
                      ? toTokyoHHMM(daySchedule.checkoutSpot.check_out)
                      : "")
                  }
                  onChange={(e) =>
                    handleSaveDayPatch({ departure_time: e.target.value || null })
                  }
                  className="w-full px-2 py-1.5 rounded-xl border border-slate-300 text-xs font-mono font-bold"
                />
              </div>

              <div className="sm:col-span-6 flex items-center gap-1.5">
                <input
                  type="text"
                  value={
                    activeDay.departure_point ??
                    daySchedule?.checkoutSpot?.name ??
                    ""
                  }
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

      {/* iOS ネイティブアプリ風・下部タブバー（5タブ：旅程 / マップ / 費用 / 持ち物・料理 / 参加者） */}
      <nav className="bg-white/95 backdrop-blur-md border-t border-slate-200 px-1.5 py-1.5 grid grid-cols-5 gap-1 shrink-0 z-20">
        <button
          type="button"
          onClick={() => setMainTab("itinerary")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "itinerary" ? "text-blue-600 font-extrabold bg-blue-50/60" : "text-slate-500"
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">旅程</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("map")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "map" ? "text-blue-600 font-extrabold bg-blue-50/60" : "text-slate-500"
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">マップ</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("costs")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "costs" ? "text-blue-600 font-extrabold bg-blue-50/60" : "text-slate-500"
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">費用({doc.costs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("prep")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "prep" ? "text-blue-600 font-extrabold bg-blue-50/60" : "text-slate-500"
          }`}
        >
          <Backpack className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">
            準備({doc.belongings.length + doc.dishes.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab("members")}
          className={`flex flex-col items-center justify-center py-1 rounded-xl transition ${
            mainTab === "members" ? "text-blue-600 font-extrabold bg-blue-50/60" : "text-slate-500"
          }`}
        >
          <Users className="w-4 h-4" />
          <span className="text-[10px] mt-0.5">参加者({doc.participants.length})</span>
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

      {/* Muse連携エクスポートモーダル */}
      {showExportModal && (
        <MuseExportModal doc={doc} onClose={() => setShowExportModal(false)} />
      )}

      {/* しおり共有モーダル */}
      {showShareModal && (
        <ShareTripModal doc={doc} onClose={() => setShowShareModal(false)} />
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

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSidebar(false);
                    setShowShareModal(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-blue-50/70 text-left flex items-center gap-3 transition"
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
                  disabled={autoPlanBusy || doc.spots.length === 0}
                  onClick={() => {
                    setShowSidebar(false);
                    void handleAutoPlanItinerary();
                  }}
                  className="w-full px-3.5 py-3 rounded-2xl border border-purple-200 bg-purple-50/70 hover:bg-purple-100/70 text-left flex items-center gap-3 transition disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-purple-950">
                      効率ルート自動編成
                    </div>
                    <div className="text-[10px] text-purple-700">
                      優先度・枠タグ・移動時間で最適配置
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowSidebar(false);
                    setShowExportModal(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/70 text-left flex items-center gap-3 transition"
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

                <button
                  type="button"
                  onClick={() => {
                    setShowSidebar(false);
                    openNewSpotModal();
                  }}
                  className="w-full px-3.5 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center gap-3 transition"
                >
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Link2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      GoogleマップURLから追加
                    </div>
                    <div className="text-[10px] text-slate-500">
                      リンク貼り付けで営業時間も取得
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

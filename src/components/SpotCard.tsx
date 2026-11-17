"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Car,
  Footprints,
  TrainFront,
  Clock,
  Star,
  AlertTriangle,
  MapPin,
  BedDouble,
} from "lucide-react";
import type { SpotRow } from "@/lib/model/types";
import type { SpotTiming } from "@/lib/schedule/compute";
import { toTokyoHHMM } from "@/lib/datetime";

const CATEGORY_LABEL: Record<SpotRow["category"], { label: string; badge: string }> = {
  sightseeing: { label: "観光", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  meal: { label: "食事", badge: "bg-orange-50 text-orange-700 border-orange-200" },
  lodging: { label: "宿泊", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  transport: { label: "移動", badge: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  shopping: { label: "買い物", badge: "bg-pink-50 text-pink-700 border-pink-200" },
  other: { label: "その他", badge: "bg-neutral-100 text-neutral-700 border-neutral-200" },
};

const STATUS_BADGE: Record<SpotRow["status"], { label: string; cls: string }> = {
  decided: { label: "決まった", cls: "bg-emerald-600 text-white" },
  candidate: { label: "候補", cls: "bg-amber-500 text-white" },
  undecided: { label: "未定", cls: "bg-neutral-400 text-white" },
};

function ModeIcon({ mode }: { mode: SpotRow["transport_mode"] }) {
  if (mode === "walk") return <Footprints className="w-3.5 h-3.5" />;
  if (mode === "train") return <TrainFront className="w-3.5 h-3.5" />;
  return <Car className="w-3.5 h-3.5" />;
}

interface SpotCardProps {
  index: number;
  spot: SpotRow;
  timing: SpotTiming | undefined;
  onEdit: (spot: SpotRow) => void;
}

export default function SpotCard({ index, spot, timing, onEdit }: SpotCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: spot.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cat = CATEGORY_LABEL[spot.category];
  const st = STATUS_BADGE[spot.status];
  const overrun = timing?.overrun_minutes ?? 0;

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-60 z-20" : ""}>
      {/* 前のスポットからの移動バー */}
      {spot.transport_mode && (
        <div className="flex items-center gap-2 pl-6 py-1 text-xs text-neutral-500">
          <div className="w-0.5 h-4 bg-neutral-300" />
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
            <ModeIcon mode={spot.transport_mode} />
            {spot.transport_duration_minutes !== null
              ? `${spot.transport_duration_minutes}分`
              : "移動時間未設定"}
            {spot.transport_distance_m !== null &&
              ` (${(spot.transport_distance_m / 1000).toFixed(1)}km)`}
          </span>
          {timing && timing.wait_minutes > 0 && (
            <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
              予約まで待機 {timing.wait_minutes}分
            </span>
          )}
        </div>
      )}

      {/* 本体カード */}
      <div
        className={`rounded-2xl border p-3 bg-white shadow-xs transition flex items-start gap-2.5 ${
          overrun > 0 ? "border-red-400 ring-2 ring-red-100" : "border-neutral-200 hover:border-neutral-300"
        }`}
      >
        {/* ドラッグハンドル */}
        <button
          type="button"
          aria-label="並び替え"
          {...attributes}
          {...listeners}
          className="mt-1 p-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 touch-none cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* 順番バッジ + 時刻 */}
        <div className="flex flex-col items-center shrink-0 w-12 pt-0.5">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
            {index + 1}
          </span>
          {timing?.arrival && (
            <div className="mt-1 text-[11px] font-mono text-neutral-800 leading-tight text-center">
              <div className="font-bold">{toTokyoHHMM(timing.arrival)}</div>
              <div className="text-neutral-400">↓</div>
              <div>{timing.departure ? toTokyoHHMM(timing.departure) : ""}</div>
            </div>
          )}
        </div>

        {/* 詳細（クリックで編集） */}
        <button
          type="button"
          onClick={() => onEdit(spot)}
          className="flex-1 min-w-0 text-left space-y-1.5"
        >
          {/* 第3章: スケジュール破綻の赤い警告バッジ */}
          {overrun > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-bold shadow-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>⚠️ 移動が間に合いません：{overrun}分超過</span>
            </div>
          )}

          <div className="flex items-center flex-wrap gap-1.5">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>
              {st.label}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cat.badge}`}>
              {cat.label}
            </span>
            {spot.is_main && (
              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                メイン
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 text-[11px] text-neutral-500">
              <Clock className="w-3 h-3" />
              滞在{spot.stay_minutes}分
            </span>
            {spot.is_fixed && spot.reservation_time && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                予約 {toTokyoHHMM(spot.reservation_time)} 固定
              </span>
            )}
          </div>

          <div className="text-sm font-bold text-neutral-900 truncate">{spot.name}</div>

          {spot.address && (
            <div className="flex items-center gap-1 text-xs text-neutral-500 truncate">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{spot.address}</span>
            </div>
          )}

          {spot.category === "lodging" && (spot.check_in || spot.check_out) && (
            <div className="inline-flex items-center gap-1.5 text-xs text-purple-800 bg-purple-50 px-2 py-0.5 rounded-lg">
              <BedDouble className="w-3.5 h-3.5" />
              <span>
                IN {spot.check_in ? toTokyoHHMM(spot.check_in) : "未定"} / OUT{" "}
                {spot.check_out ? toTokyoHHMM(spot.check_out) : "未定"}
              </span>
            </div>
          )}

          {spot.memo && <p className="text-xs text-neutral-600 line-clamp-2">{spot.memo}</p>}
        </button>
      </div>
    </div>
  );
}

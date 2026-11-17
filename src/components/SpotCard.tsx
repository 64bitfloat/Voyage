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
import {
  checkBusinessHoursAlert,
  checkLodgingPolicyAlert,
  dayNumberToJa,
  deserializeBusinessHours,
} from "@/lib/geo/business-hours";

const CATEGORY_STYLE: Record<
  SpotRow["category"],
  { label: string; dot: string; badge: string }
> = {
  sightseeing: {
    label: "観光",
    dot: "bg-blue-600 ring-blue-100",
    badge: "bg-blue-50 text-blue-700 border-blue-200/80",
  },
  onsen: {
    label: "温泉",
    dot: "bg-rose-600 ring-rose-100",
    badge: "bg-rose-50 text-rose-700 border-rose-200/80",
  },
  meal: {
    label: "食事",
    dot: "bg-orange-500 ring-orange-100",
    badge: "bg-orange-50 text-orange-700 border-orange-200/80",
  },
  lodging: {
    label: "宿泊",
    dot: "bg-purple-600 ring-purple-100",
    badge: "bg-purple-50 text-purple-700 border-purple-200/80",
  },
  transport: {
    label: "移動",
    dot: "bg-cyan-600 ring-cyan-100",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200/80",
  },
  shopping: {
    label: "買い物",
    dot: "bg-pink-600 ring-pink-100",
    badge: "bg-pink-50 text-pink-700 border-pink-200/80",
  },
  other: {
    label: "その他",
    dot: "bg-slate-600 ring-slate-100",
    badge: "bg-slate-100 text-slate-700 border-slate-200/80",
  },
};

const STATUS_BADGE: Record<SpotRow["status"], { label: string; cls: string }> = {
  decided: { label: "決まった", cls: "bg-emerald-600 text-white" },
  candidate: { label: "候補", cls: "bg-amber-500 text-white" },
  undecided: { label: "未定", cls: "bg-slate-400 text-white" },
};

function ModeIcon({ mode }: { mode: SpotRow["transport_mode"] }) {
  if (mode === "walk") return <Footprints className="w-3.5 h-3.5 text-emerald-600" />;
  if (mode === "train") return <TrainFront className="w-3.5 h-3.5 text-indigo-600" />;
  return <Car className="w-3.5 h-3.5 text-blue-600" />;
}

interface SpotCardProps {
  index: number;
  spot: SpotRow;
  dayDate: string | null;
  timing: SpotTiming | undefined;
  onEdit: (spot: SpotRow) => void;
}

export default function SpotCard({ index, spot, dayDate, timing, onEdit }: SpotCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: spot.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cat = CATEGORY_STYLE[spot.category];
  const st = STATUS_BADGE[spot.status];
  const overrun = timing?.overrun_minutes ?? 0;
  const bhRule = deserializeBusinessHours(spot.transport_note);
  const bhAlert =
    spot.category === "lodging"
      ? checkLodgingPolicyAlert(
          bhRule,
          spot.check_in ? toTokyoHHMM(spot.check_in) : null,
          spot.check_out ? toTokyoHHMM(spot.check_out) : null,
        )
      : checkBusinessHoursAlert(
          bhRule,
          dayDate,
          timing?.arrival ? toTokyoHHMM(timing.arrival) : null,
          timing?.departure ? toTokyoHHMM(timing.departure) : null,
        );
  const hasBhInfo = Boolean(bhRule.open && bhRule.close) || bhRule.closedDays.length > 0;

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-60 z-20" : ""}>
      {/* Voyage風・前の地点からの移動コネクタピル */}
      {spot.transport_mode && (
        <div className="grid grid-cols-[54px_20px_1fr] items-center py-1">
          <div />
          <div className="flex justify-center h-full">
            <div className="w-0.5 h-7 border-l-2 border-dashed border-slate-300" />
          </div>
          <div className="flex items-center flex-wrap gap-1.5 pl-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-slate-200/90 shadow-2xs text-[11px] font-semibold text-slate-700">
              <ModeIcon mode={spot.transport_mode} />
              <span>
                {spot.transport_duration_minutes !== null
                  ? `${spot.transport_duration_minutes}分`
                  : "移動時間未設定"}
              </span>
              {spot.transport_distance_m !== null && (
                <span className="text-slate-400 font-normal">
                  ({(spot.transport_distance_m / 1000).toFixed(1)}km)
                </span>
              )}
            </span>
            {timing && timing.wait_minutes > 0 && (
              <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                予約まで待機 {timing.wait_minutes}分
              </span>
            )}
            {timing?.must_leave_prev_by && (
              <span
                className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
                title={timing.leave_by_reason ?? undefined}
              >
                🕒 前の場所を {timing.must_leave_prev_by} までに出発すればOK
              </span>
            )}
          </div>
        </div>
      )}

      {/* クロノグラフ・タイムライン行（左: 時刻軸 / 中: ピン番号ノード / 右: リッチカード） */}
      <div className="grid grid-cols-[54px_20px_1fr] items-stretch gap-x-1">
        {/* 左カラム: 到着・出発予定時刻 */}
        <div className="flex flex-col justify-between py-2.5 pr-1 text-right font-mono">
          {timing?.arrival ? (
            <>
              <span
                className={`text-xs font-extrabold tracking-tight ${
                  overrun > 0 ? "text-red-600" : "text-slate-900"
                }`}
              >
                {toTokyoHHMM(timing.arrival)}
              </span>
              {timing.departure && timing.departure !== timing.arrival && (
                <span className="text-[10px] text-slate-400 font-medium">
                  {toTokyoHHMM(timing.departure)}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-slate-300">--:--</span>
          )}
        </div>

        {/* 中央カラム: 縦ライン + 番号付きノード */}
        <div className="relative flex flex-col items-center">
          <div className="w-0.5 flex-1 bg-slate-200" />
          <div
            className={`w-6 h-6 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center ring-4 shadow-xs shrink-0 ${cat.dot}`}
          >
            {index + 1}
          </div>
          <div className="w-0.5 flex-1 bg-slate-200" />
        </div>

        {/* 右カラム: スポットカード本体 */}
        <div className="py-1 pl-1.5 min-w-0">
          <div
            className={`rounded-2xl border p-3 bg-white shadow-xs transition flex items-start gap-2 ${
              overrun > 0
                ? "border-red-400 ring-2 ring-red-100 bg-red-50/20"
                : bhAlert
                  ? "border-amber-400 ring-2 ring-amber-100 bg-amber-50/20"
                  : "border-slate-200/90 hover:border-slate-300"
            }`}
          >
            <button
              type="button"
              onClick={() => onEdit(spot)}
              className="flex-1 min-w-0 text-left space-y-1.5"
            >
              {/* 第3章: スケジュール破綻の赤い警告バッジ */}
              {overrun > 0 && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-red-600 text-white text-xs font-bold shadow-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>⚠️ 移動が間に合いません：{overrun}分超過</span>
                </div>
              )}

              {/* 営業時間外・定休日アラートバッジ */}
              {bhAlert && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-600 text-white text-xs font-bold shadow-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{bhAlert}</span>
                </div>
              )}

              <div className="flex items-center flex-wrap gap-1.5">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>
                  {st.label}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cat.badge}`}
                >
                  {cat.label}
                </span>
                {spot.is_main && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                    メイン
                  </span>
                )}
                {!(spot.category === "lodging" && (spot.check_in || spot.check_out)) && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 font-medium">
                    <Clock className="w-3 h-3" />
                    {spot.stay_minutes}分
                  </span>
                )}
                {spot.is_fixed && spot.reservation_time && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    予約 {toTokyoHHMM(spot.reservation_time)} 固定
                  </span>
                )}
                {!spot.is_fixed && bhRule.targetTime && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                    目標 {bhRule.targetTime}ごろ
                  </span>
                )}
                {hasBhInfo && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                    {bhRule.open && bhRule.close ? `営 ${bhRule.open}-${bhRule.close}` : ""}
                    {bhRule.closedDays.length > 0
                      ? `${bhRule.open ? " / " : ""}休:${bhRule.closedDays
                          .map((d) => dayNumberToJa(d))
                          .join("")}`
                      : ""}
                  </span>
                )}
                {(bhRule.slotTags ?? []).map((st) => (
                  <span
                    key={st.id}
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200"
                    title={`目安時間帯: ${st.windowStart}〜${st.windowEnd}`}
                  >
                    🎯 {st.label} ({st.windowStart}-{st.windowEnd})
                  </span>
                ))}
              </div>

              <div className="text-sm font-extrabold text-slate-900 truncate">{spot.name}</div>

              {spot.address && (
                <div className="flex items-center gap-1 text-xs text-slate-500 truncate">
                  <MapPin className="w-3 h-3 shrink-0 text-slate-400" />
                  <span className="truncate">{spot.address}</span>
                </div>
              )}

              {spot.category === "lodging" && (spot.check_in || spot.check_out) && (
                <div className="inline-flex items-center flex-wrap gap-1.5 text-xs text-purple-800 bg-purple-50 px-2.5 py-0.5 rounded-lg font-medium">
                  <BedDouble className="w-3.5 h-3.5" />
                  <span>
                    予定: IN {spot.check_in ? toTokyoHHMM(spot.check_in) : "未定"} / OUT{" "}
                    {spot.check_out ? toTokyoHHMM(spot.check_out) : "未定"}
                  </span>
                  {(bhRule.policyCheckIn || bhRule.policyCheckOut) && (
                    <span className="text-[10px] text-purple-600">
                      （規定 IN {bhRule.policyCheckIn ?? "-"}〜 / OUT 〜{bhRule.policyCheckOut ?? "-"}）
                    </span>
                  )}
                </div>
              )}

              {spot.memo && <p className="text-xs text-slate-600 line-clamp-2">{spot.memo}</p>}
            </button>

            {/* ドラッグハンドル（右端にスッキリ配置） */}
            <button
              type="button"
              aria-label="並び替え"
              {...attributes}
              {...listeners}
              className="p-1.5 rounded-xl text-slate-300 hover:text-slate-600 hover:bg-slate-100 touch-none cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

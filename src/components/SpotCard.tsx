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
  Pencil,
  Navigation,
  Target,
} from "lucide-react";
import type { SpotRow } from "@/lib/model/types";
import type { SpotTiming } from "@/lib/schedule/compute";
import { toTokyoHHMM } from "@/lib/datetime";
import { buildGoogleMapsNavUrl } from "@/lib/geo/nav";
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
    dot: "bg-white text-slate-700 border-2 border-slate-300 ring-white/60",
    badge: "bg-slate-100/80 text-slate-600 border-slate-200/80",
  },
  onsen: {
    label: "温泉",
    dot: "bg-white text-slate-700 border-2 border-slate-300 ring-white/60",
    badge: "bg-slate-100/80 text-slate-600 border-slate-200/80",
  },
  meal: {
    label: "食事",
    dot: "bg-white text-slate-700 border-2 border-slate-300 ring-white/60",
    badge: "bg-slate-100/80 text-slate-600 border-slate-200/80",
  },
  lodging: {
    label: "宿泊",
    dot: "bg-[var(--theme-accent)] text-white border-2 border-[var(--theme-accent)] ring-white/70",
    badge: "bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border-[var(--theme-accent-border)]",
  },
  transport: {
    label: "移動",
    dot: "bg-white text-slate-700 border-2 border-slate-300 ring-white/60",
    badge: "bg-slate-100/80 text-slate-600 border-slate-200/80",
  },
  shopping: {
    label: "買い物",
    dot: "bg-white text-slate-700 border-2 border-slate-300 ring-white/60",
    badge: "bg-slate-100/80 text-slate-600 border-slate-200/80",
  },
  other: {
    label: "その他",
    dot: "bg-white text-slate-700 border-2 border-slate-300 ring-white/60",
    badge: "bg-slate-100/80 text-slate-600 border-slate-200/80",
  },
};

const STATUS_BADGE: Record<SpotRow["status"], { label: string; cls: string }> = {
  decided: {
    label: "決まった",
    cls: "bg-[var(--theme-accent)] text-white",
  },
  candidate: {
    label: "候補",
    cls: "bg-slate-200/85 text-slate-700",
  },
  undecided: {
    label: "未定",
    cls: "bg-slate-100 text-slate-500 border border-slate-200/80",
  },
};

function ModeIcon({ mode }: { mode: SpotRow["transport_mode"] }) {
  if (mode === "walk") return <Footprints className="w-3.5 h-3.5 text-slate-600" />;
  if (mode === "train") return <TrainFront className="w-3.5 h-3.5 text-slate-600" />;
  return <Car className="w-3.5 h-3.5 text-slate-600" />;
}

interface SpotCardProps {
  index: number;
  spot: SpotRow;
  dayDate: string | null;
  timing: SpotTiming | undefined;
  reorderMode?: boolean;
  onEdit: (spot: SpotRow) => void;
  onEditLeg?: (spot: SpotRow) => void;
}

export default function SpotCard({
  index,
  spot,
  dayDate,
  timing,
  reorderMode = false,
  onEdit,
  onEditLeg,
}: SpotCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: spot.id,
    disabled: !reorderMode,
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

  const effectiveMode = spot.transport_mode ?? "car";
  const isTargetTime = !spot.is_fixed && Boolean(bhRule.targetTime);
  const gmapNavUrl = buildGoogleMapsNavUrl(spot);

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-60 z-20" : ""}>
      {/* Voyage風・前の地点からの移動コネクタピル（タップで移動区間を編集） */}
      {(spot.day_index >= 1 || spot.transport_mode) && (
        <div className="grid grid-cols-[58px_20px_1fr] items-center py-1">
          <div />
          <div className="flex justify-center h-full">
            <div className="w-0.5 h-7 border-l-2 border-dashed border-slate-300" />
          </div>
          <div className="flex items-center flex-wrap gap-1.5 pl-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditLeg?.(spot);
              }}
              title="この区間の移動手段・高速設定を編集"
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full liquid-glass-pill text-[11px] font-semibold text-slate-700 ${
                onEditLeg
                  ? "hover:border-blue-300 hover:bg-white/85 active:scale-[0.98] transition cursor-pointer"
                  : ""
              }`}
            >
              <ModeIcon mode={effectiveMode} />
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
              {effectiveMode === "car" && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100/90 text-slate-600 border border-slate-200/80">
                  {bhRule.avoidTolls ? "高速回避" : "高速優先"}
                </span>
              )}
              {onEditLeg && <Pencil className="w-2.5 h-2.5 text-slate-400 ml-0.5" />}
            </button>
            {timing && timing.wait_minutes > 0 && (
              <span className="text-[10px] font-semibold text-stone-700 bg-stone-100/90 border border-stone-200/80 px-2 py-0.5 rounded-full">
                予約まで待機 {timing.wait_minutes}分
              </span>
            )}
            {timing?.must_leave_prev_by && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]"
                title={timing.leave_by_reason ?? undefined}
              >
                <Clock className="w-3 h-3 shrink-0" />
                <span>前の場所を {timing.must_leave_prev_by} までに出発すればOK</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* クロノグラフ・タイムライン行（左: 時刻軸 / 中: ピン番号ノード / 右: リッチカード） */}
      <div className="grid grid-cols-[58px_20px_1fr] items-stretch gap-x-1">
        {/* 左カラム: 到着・出発予定時刻 */}
        <div className="flex flex-col justify-between py-2.5 pr-1 text-right font-mono whitespace-nowrap">
          {timing?.arrival ? (
            <>
              <span
                className={`text-xs font-extrabold tracking-tight ${
                  overrun > 0 ? "text-red-600" : "text-slate-900"
                }`}
              >
                {toTokyoHHMM(timing.arrival)}
                {isTargetTime ? "頃" : ""}
              </span>
              {timing.departure && timing.departure !== timing.arrival && (
                <span className="text-[10px] text-slate-400 font-medium">
                  {toTokyoHHMM(timing.departure)}
                  {isTargetTime ? "頃" : ""}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-slate-300">--:--</span>
          )}
        </div>

        {/* 中央カラム: 縦ライン + 番号付きノード */}
        <div className="relative flex flex-col items-center">
          <div className="w-0.5 flex-1 bg-slate-300/60" />
          <div
            className={`w-6 h-6 rounded-full text-[11px] font-extrabold flex items-center justify-center ring-4 shadow-xs shrink-0 ${
              spot.is_main
                ? "bg-[var(--theme-accent)] text-white border-2 border-[var(--theme-accent)] ring-white/70"
                : cat.dot
            }`}
          >
            {index + 1}
          </div>
          <div className="w-0.5 flex-1 bg-slate-300/60" />
        </div>

        {/* 右カラム: スポットカード本体 */}
        <div className="py-1 pl-1.5 min-w-0">
          <div
            className={`rounded-2xl p-3 transition flex items-start gap-2 liquid-glass ${
              overrun > 0
                ? "!border-[#c45c5c] ring-2 ring-[#c45c5c]/20 !bg-[#fdf3f3]/85"
                : bhAlert
                  ? "!border-[#c48b3b] ring-2 ring-[#c48b3b]/20 !bg-[#fdf8ee]/85"
                  : "hover:bg-white/80"
            }`}
          >
            <button
              type="button"
              onClick={() => onEdit(spot)}
              className="flex-1 min-w-0 text-left space-y-1.5"
            >
              {/* 第3章: スケジュール破綻の警告バッジ（テーマから浮かない落ち着いた赤系サブカラー） */}
              {overrun > 0 && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#b84242] text-white text-xs font-bold shadow-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>移動が間に合いません：{overrun}分超過</span>
                </div>
              )}

              {/* 営業時間外・定休日アラートバッジ（落ち着いたアンバー系サブカラー） */}
              {bhAlert && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#b46b1e] text-white text-xs font-bold shadow-xs">
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
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]">
                    <Star className="w-3 h-3 fill-current" />
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
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]">
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
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)]"
                    title={`目安時間帯: ${st.windowStart}〜${st.windowEnd}`}
                  >
                    <Target className="w-2.5 h-2.5 shrink-0" />
                    <span>{st.label} ({st.windowStart}-{st.windowEnd})</span>
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
                <div className="inline-flex items-center flex-wrap gap-1.5 text-xs bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)] border border-[var(--theme-accent-border)] px-2.5 py-0.5 rounded-lg font-medium">
                  <BedDouble className="w-3.5 h-3.5" />
                  <span>
                    予定: IN {spot.check_in ? toTokyoHHMM(spot.check_in) : "未定"} / OUT{" "}
                    {spot.check_out ? toTokyoHHMM(spot.check_out) : "未定"}
                  </span>
                  {(bhRule.policyCheckIn || bhRule.policyCheckOut) && (
                    <span className="text-[10px] opacity-80">
                      （規定 IN {bhRule.policyCheckIn ?? "-"}〜 / OUT 〜{bhRule.policyCheckOut ?? "-"}）
                    </span>
                  )}
                </div>
              )}

              {spot.memo && <p className="text-xs text-slate-600 line-clamp-2">{spot.memo}</p>}
            </button>

            {/* 右端アクション列（順番編集モード時のみドラッグハンドル表示＋ワンタップ道案内） */}
            <div className="flex flex-col items-end justify-between self-stretch shrink-0 gap-2">
              {reorderMode && (
                <button
                  type="button"
                  aria-label="並び替え"
                  {...attributes}
                  {...listeners}
                  className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 touch-none cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="w-4 h-4" />
                </button>
              )}
              {gmapNavUrl && (
                <a
                  href={gmapNavUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="現在地からGoogleマップで道案内を開始"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full liquid-glass-pill hover:bg-white text-slate-700 hover:text-[var(--theme-accent-text)] text-[10px] font-bold transition active:scale-95"
                >
                  <Navigation className="w-3 h-3" />
                  <span>ナビ</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

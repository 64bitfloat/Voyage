"use client";

import { Clock, X } from "lucide-react";

interface TimeSelectProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** 「未定」を選べるようにするか（既定 true） */
  allowUndecided?: boolean;
  /** 未定のときに表示するラベル */
  undecidedLabel?: string;
  /** 時刻を新規に選び始めたときのデフォルト時（例: "12"） */
  defaultHour?: string;
  className?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/**
 * ブラウザ標準 <input type="time"> の無限ループ（59→00）や現在時刻の分（例: 53分）が出る問題を解消し、
 * 「00〜23時」「00〜59分（循環なし）」および「未定」を確実に選べるカスタム時刻セレクター
 */
export default function TimeSelect({
  value,
  onChange,
  disabled = false,
  allowUndecided = true,
  undecidedLabel = "未定",
  defaultHour = "12",
  className = "",
}: TimeSelectProps) {
  const hasValue = Boolean(value && /^\d{2}:\d{2}$/.test(value));
  const [hh, mm] = hasValue ? value!.split(":") : ["", ""];

  function handleHourChange(newHour: string) {
    if (!newHour) {
      onChange(null);
      return;
    }
    // 分が未選択のときは必ず "00" から開始する
    const nextMin = mm || "00";
    onChange(`${newHour}:${nextMin}`);
  }

  function handleMinuteChange(newMin: string) {
    if (!newMin) {
      onChange(null);
      return;
    }
    const nextHour = hh || defaultHour;
    onChange(`${nextHour}:${newMin}`);
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2 py-1 text-xs font-mono ${
        disabled ? "opacity-50 bg-slate-100 pointer-events-none" : ""
      } ${className}`}
    >
      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />

      {/* 時 (00〜23 / 未定) */}
      <select
        disabled={disabled}
        value={hh}
        onChange={(e) => handleHourChange(e.target.value)}
        aria-label="時"
        className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer py-0.5"
      >
        {allowUndecided && <option value="">{undecidedLabel}</option>}
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>

      <span className="text-slate-400 font-bold">:</span>

      {/* 分 (00〜59、循環なし・初期値00) */}
      <select
        disabled={disabled}
        value={mm}
        onChange={(e) => handleMinuteChange(e.target.value)}
        aria-label="分"
        className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer py-0.5"
      >
        {allowUndecided && <option value="">--</option>}
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {allowUndecided && hasValue && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-0.5 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          title="時間未定にする"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Asia/Tokyo 固定の日時ユーティリティ。
 * 日本は夏時間がないため、オフセットは常に +09:00。
 */
const JST_OFFSET_MIN = 9 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → "2026-12-12T10:00:00+09:00" */
export function toTokyoISO(date: Date): string {
  const t = new Date(date.getTime() + JST_OFFSET_MIN * 60_000);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+09:00`
  );
}

/** "2026-12-12" + "10:00" → "2026-12-12T10:00:00+09:00" */
export function combineDateTime(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/** Date → "2026-12-12"（東京基準） */
export function toTokyoDate(date: Date): string {
  return toTokyoISO(date).slice(0, 10);
}

/** ISO日時の差（分）。a - b */
export function diffMinutes(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 60_000);
}

/** ISO日時 → "10:00"（東京基準） */
export function toTokyoHHMM(iso: string): string {
  return toTokyoISO(new Date(iso)).slice(11, 16);
}

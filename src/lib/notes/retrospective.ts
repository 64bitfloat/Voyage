/**
 * 「次回の旅行に活かしたいこと」メモのシリアライズ・パース。
 * DBスキーマ変更不要で既存の trip.notes（text）にそのまま保存し、
 * エクスポートJSON・Markdownでも人間やAIがそのまま読める箇条書きとして扱う。
 */

export type RetroCategory = "good" | "improve" | "next" | "packing";

export interface RetroNoteItem {
  id: string;
  category: RetroCategory;
  text: string;
  author: string;
}

export const RETRO_CATEGORIES: { value: RetroCategory; label: string }[] = [
  { value: "good", label: "良かった点" },
  { value: "improve", label: "改善・注意点" },
  { value: "next", label: "次回やりたい" },
  { value: "packing", label: "持ち物・準備" },
];

const LABEL_TO_CAT = new Map<string, RetroCategory>(
  RETRO_CATEGORIES.map((c) => [c.label, c.value]),
);
const CAT_TO_LABEL = new Map<RetroCategory, string>(
  RETRO_CATEGORIES.map((c) => [c.value, c.label]),
);

const LINE_RE = /^- \[([^\]]+)\]\s*(.+?)(?:\s+\(@([^)]+)\))?\s*$/;

export function parseRetroNotes(raw: string): RetroNoteItem[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const m = line.match(LINE_RE);
      if (m) {
        const cat = LABEL_TO_CAT.get(m[1]) ?? "next";
        return {
          id: `retro-${idx}`,
          category: cat,
          text: m[2].trim(),
          author: (m[3] ?? "").trim(),
        };
      }
      return {
        id: `retro-${idx}`,
        category: "next" as RetroCategory,
        text: line.replace(/^-\s*/, ""),
        author: "",
      };
    });
}

export function serializeRetroNotes(items: RetroNoteItem[]): string {
  return items
    .filter((it) => it.text.trim())
    .map((it) => {
      const label = CAT_TO_LABEL.get(it.category) ?? "次回やりたい";
      const clean = it.text.replace(/\r?\n/g, " ").trim();
      const authorPart = it.author.trim() ? ` (@${it.author.trim()})` : "";
      return `- [${label}] ${clean}${authorPart}`;
    })
    .join("\n");
}

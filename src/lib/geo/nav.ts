import type { SpotRow } from "@/lib/model/types";
import { deserializeBusinessHours } from "./business-hours";

/**
 * 現在地（origin省略＝Googleマップが自動取得）から指定スポットへの
 * Googleマップ道案内（ターンバイターンナビ）URLを生成する。
 */
export function buildGoogleMapsNavUrl(spot: SpotRow): string | null {
  const dest =
    spot.lat !== null && spot.lng !== null
      ? `${spot.lat},${spot.lng}`
      : spot.address?.trim() || spot.name.trim();
  if (!dest) return null;

  const travelmode =
    spot.transport_mode === "walk"
      ? "walking"
      : spot.transport_mode === "train"
        ? "transit"
        : "driving";

  const bh = deserializeBusinessHours(spot.transport_note);
  const avoidParam =
    travelmode === "driving" && bh.avoidTolls ? "&avoid=tolls,highways" : "";

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=${travelmode}&dir_action=navigate${avoidParam}`;
}

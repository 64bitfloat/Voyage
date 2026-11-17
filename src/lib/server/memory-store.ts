import type { DayRow, SpotRow, TripDoc, TripRow } from "../model/types";
import type { TripStore } from "./store";

/** ローカル開発用のメモリ実装（HMRでも消えないよう globalThis に保持） */
const g = globalThis as unknown as { __voyageMem?: Map<string, TripDoc> };
const db = (g.__voyageMem ??= new Map<string, TripDoc>());

export class MemoryStore implements TripStore {
  readonly kind = "memory" as const;

  async getTripDoc(tripId: string) {
    const doc = db.get(tripId);
    return doc ? structuredClone(doc) : null;
  }

  async createTrip(trip: Omit<TripRow, "has_passcode">, days: DayRow[]) {
    db.set(trip.id, { trip: { ...trip, has_passcode: false }, days: structuredClone(days), spots: [] });
  }

  async updateTrip(tripId: string, patch: Partial<Pick<TripRow, "title" | "notes">>) {
    const doc = db.get(tripId);
    if (doc) Object.assign(doc.trip, patch);
  }

  async upsertDay(tripId: string, day: DayRow) {
    const doc = db.get(tripId);
    if (!doc) return;
    const i = doc.days.findIndex((d) => d.day_index === day.day_index);
    if (i >= 0) doc.days[i] = day;
    else doc.days.push(day);
    doc.days.sort((a, b) => a.day_index - b.day_index);
  }

  async createSpot(tripId: string, spot: SpotRow) {
    const doc = db.get(tripId);
    if (doc && !doc.spots.some((s) => s.id === spot.id)) doc.spots.push(spot);
  }

  async updateSpot(tripId: string, spotId: string, patch: Partial<SpotRow>) {
    const s = db.get(tripId)?.spots.find((x) => x.id === spotId);
    if (!s) return false;
    Object.assign(s, patch);
    return true;
  }

  async deleteSpot(tripId: string, spotId: string) {
    const doc = db.get(tripId);
    if (!doc) return false;
    const before = doc.spots.length;
    doc.spots = doc.spots.filter((s) => s.id !== spotId);
    return doc.spots.length < before;
  }

  async reorderSpots(tripId: string, dayIndex: number, orderedIds: string[]) {
    const doc = db.get(tripId);
    if (!doc) return;
    orderedIds.forEach((id, i) => {
      const s = doc.spots.find((x) => x.id === id && x.day_index === dayIndex);
      if (s) s.sort_order = i;
    });
  }
}

import type {
  BelongingRow,
  CostRow,
  DayRow,
  DishRow,
  ParticipantRow,
  PhotoRow,
  SpotRow,
  TripDoc,
  TripRow,
} from "../model/types";
import { verifyPasscode } from "./passcode";
import type { TripStore } from "./store";

interface StoredTrip {
  doc: TripDoc;
  passcodeHash: string | null;
}

/** ローカル開発用のメモリ実装（HMRでも消えないよう globalThis に保持） */
const g = globalThis as unknown as { __voyageMemV3?: Map<string, StoredTrip> };
const db = (g.__voyageMemV3 ??= new Map<string, StoredTrip>());

export class MemoryStore implements TripStore {
  readonly kind = "memory" as const;

  async getTripDoc(tripId: string): Promise<TripDoc | null> {
    const entry = db.get(tripId);
    return entry ? structuredClone(entry.doc) : null;
  }

  async createTrip(
    trip: Omit<TripRow, "has_passcode">,
    days: DayRow[],
    passcodeHash?: string | null,
  ) {
    db.set(trip.id, {
      doc: {
        trip: { ...trip, has_passcode: !!passcodeHash },
        days: structuredClone(days),
        spots: [],
        participants: [],
        costs: [],
        belongings: [],
        dishes: [],
        photos: [],
      },
      passcodeHash: passcodeHash ?? null,
    });
  }

  async verifyTripPasscode(tripId: string, passcode: string): Promise<boolean> {
    const entry = db.get(tripId);
    if (!entry) return false;
    return verifyPasscode(passcode, entry.passcodeHash);
  }

  async updateTrip(tripId: string, patch: Partial<Pick<TripRow, "title" | "notes">>) {
    const entry = db.get(tripId);
    if (entry) Object.assign(entry.doc.trip, patch);
  }

  async upsertDay(tripId: string, day: DayRow) {
    const entry = db.get(tripId);
    if (!entry) return;
    const i = entry.doc.days.findIndex((d) => d.day_index === day.day_index);
    if (i >= 0) entry.doc.days[i] = day;
    else entry.doc.days.push(day);
    entry.doc.days.sort((a, b) => a.day_index - b.day_index);
  }

  async createSpot(tripId: string, spot: SpotRow) {
    const entry = db.get(tripId);
    if (entry && !entry.doc.spots.some((s) => s.id === spot.id)) entry.doc.spots.push(spot);
  }

  async updateSpot(tripId: string, spotId: string, patch: Partial<SpotRow>) {
    const s = db.get(tripId)?.doc.spots.find((x) => x.id === spotId);
    if (!s) return false;
    Object.assign(s, patch);
    return true;
  }

  async deleteSpot(tripId: string, spotId: string) {
    const entry = db.get(tripId);
    if (!entry) return false;
    const before = entry.doc.spots.length;
    entry.doc.spots = entry.doc.spots.filter((s) => s.id !== spotId);
    entry.doc.photos = entry.doc.photos.filter((p) => p.spot_id !== spotId);
    return entry.doc.spots.length < before;
  }

  async reorderSpots(tripId: string, dayIndex: number, orderedIds: string[]) {
    const entry = db.get(tripId);
    if (!entry) return;
    orderedIds.forEach((id, i) => {
      const s = entry.doc.spots.find((x) => x.id === id && x.day_index === dayIndex);
      if (s) s.sort_order = i;
    });
  }

  async upsertParticipant(tripId: string, participant: ParticipantRow) {
    const entry = db.get(tripId);
    if (!entry) return;
    const i = entry.doc.participants.findIndex((p) => p.id === participant.id);
    if (i >= 0) entry.doc.participants[i] = participant;
    else entry.doc.participants.push(participant);
  }

  async deleteParticipant(tripId: string, participantId: string) {
    const entry = db.get(tripId);
    if (!entry) return;
    entry.doc.participants = entry.doc.participants.filter((p) => p.id !== participantId);
  }

  async upsertCost(tripId: string, cost: CostRow) {
    const entry = db.get(tripId);
    if (!entry) return;
    const i = entry.doc.costs.findIndex((c) => c.id === cost.id);
    if (i >= 0) entry.doc.costs[i] = cost;
    else entry.doc.costs.push(cost);
  }

  async deleteCost(tripId: string, costId: string) {
    const entry = db.get(tripId);
    if (!entry) return;
    entry.doc.costs = entry.doc.costs.filter((c) => c.id !== costId);
  }

  async upsertBelonging(tripId: string, belonging: BelongingRow) {
    const entry = db.get(tripId);
    if (!entry) return;
    const i = entry.doc.belongings.findIndex((b) => b.id === belonging.id);
    if (i >= 0) entry.doc.belongings[i] = belonging;
    else entry.doc.belongings.push(belonging);
  }

  async deleteBelonging(tripId: string, belongingId: string) {
    const entry = db.get(tripId);
    if (!entry) return;
    entry.doc.belongings = entry.doc.belongings.filter((b) => b.id !== belongingId);
  }

  async upsertDish(tripId: string, dish: DishRow) {
    const entry = db.get(tripId);
    if (!entry) return;
    const i = entry.doc.dishes.findIndex((d) => d.id === dish.id);
    if (i >= 0) entry.doc.dishes[i] = dish;
    else entry.doc.dishes.push(dish);
  }

  async deleteDish(tripId: string, dishId: string) {
    const entry = db.get(tripId);
    if (!entry) return;
    entry.doc.dishes = entry.doc.dishes.filter((d) => d.id !== dishId);
  }

  async createPhoto(tripId: string, photo: PhotoRow) {
    const entry = db.get(tripId);
    if (entry && !entry.doc.photos.some((p) => p.id === photo.id)) {
      entry.doc.photos.push(photo);
    }
  }

  async deletePhoto(tripId: string, photoId: string) {
    const entry = db.get(tripId);
    if (!entry) return;
    entry.doc.photos = entry.doc.photos.filter((p) => p.id !== photoId);
  }
}

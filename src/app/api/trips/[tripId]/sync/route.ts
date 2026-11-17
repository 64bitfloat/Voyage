import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BelongingRowSchema,
  CostRowSchema,
  DayRowSchema,
  DishRowSchema,
  ParticipantRowSchema,
  PhotoRowSchema,
  SpotRowSchema,
  TripRowSchema,
  type TripDoc,
} from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

const FullTripDocSchema = z.object({
  trip: TripRowSchema,
  days: z.array(DayRowSchema),
  spots: z.array(SpotRowSchema),
  participants: z.array(ParticipantRowSchema),
  costs: z.array(CostRowSchema),
  belongings: z.array(BelongingRowSchema),
  dishes: z.array(DishRowSchema),
  photos: z.array(PhotoRowSchema).default([]),
});

/**
 * クライアントが保持している最新の TripDoc 全体をサーバー側ストアへ一括同期する
 * （Vercel サーバーレス環境で別インスタンスが立ち上がった際も、このエンドポイントで即座にサーバー側メモリを再構築できる）
 */
export async function PUT(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const body = await parseBody(req, FullTripDocSchema);
  if (!body.ok) return body.res;
  try {
    const doc = body.data as TripDoc;
    const store = getStore();
    const existing = await store.getTripDoc(tripId);
    if (!existing) {
      await store.createTrip(
        {
          id: tripId,
          title: doc.trip.title,
          start_date: doc.trip.start_date,
          end_date: doc.trip.end_date,
          notes: doc.trip.notes,
        },
        doc.days,
        null,
      );
    } else {
      await store.updateTrip(tripId, {
        title: doc.trip.title,
        start_date: doc.trip.start_date,
        end_date: doc.trip.end_date,
        notes: doc.trip.notes,
      });
      for (const d of doc.days) {
        await store.upsertDay(tripId, d);
      }
    }
    for (const s of doc.spots) {
      if (s.day_index === 0 && !doc.days.some((d) => d.day_index === 0)) {
        await store.upsertDay(tripId, {
          day_index: 0,
          label: "候補プール",
          date: null,
          departure_point: null,
          departure_lat: null,
          departure_lng: null,
          departure_time: null,
        });
      }
      await store.createSpot(tripId, s);
      await store.updateSpot(tripId, s.id, s);
    }
    for (const p of doc.participants) {
      await store.upsertParticipant(tripId, p);
    }
    for (const c of doc.costs) {
      await store.upsertCost(tripId, c);
    }
    for (const b of doc.belongings) {
      await store.upsertBelonging(tripId, b);
    }
    for (const d of doc.dishes) {
      await store.upsertDish(tripId, d);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

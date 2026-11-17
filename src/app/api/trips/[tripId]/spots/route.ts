import { NextResponse } from "next/server";
import { CreateSpotInput } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

/** スポット追加（id はクライアント生成の UUID。再送されても重複しない） */
export async function POST(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const body = await parseBody(req, CreateSpotInput);
  if (!body.ok) return body.res;
  try {
    const store = getStore();
    const doc = await store.getTripDoc(tripId);
    if (!doc) return jsonError(404, "旅行が見つかりません");
    if (!doc.days.some((d) => d.day_index === body.data.day_index)) {
      if (body.data.day_index === 0) {
        await store.upsertDay(tripId, {
          day_index: 0,
          label: "候補プール",
          date: null,
          departure_point: null,
          departure_lat: null,
          departure_lng: null,
          departure_time: null,
        });
      } else {
        return jsonError(422, "日程が存在しません");
      }
    }
    await store.createSpot(tripId, body.data);
    return NextResponse.json(body.data, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}

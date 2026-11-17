import { NextResponse } from "next/server";
import { UpdateTripInput } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  try {
    const doc = await getStore().getTripDoc(tripId);
    if (!doc) return jsonError(404, "旅行が見つかりません");
    return NextResponse.json(doc, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const body = await parseBody(req, UpdateTripInput);
  if (!body.ok) return body.res;
  try {
    await getStore().updateTrip(tripId, body.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

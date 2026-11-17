import { NextResponse } from "next/server";
import { UpdateSpotInput } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string; spotId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { tripId, spotId } = await params;
  if (!isUuid(tripId) || !isUuid(spotId)) return jsonError(404, "スポットが見つかりません");
  const body = await parseBody(req, UpdateSpotInput);
  if (!body.ok) return body.res;
  try {
    const ok = await getStore().updateSpot(tripId, spotId, body.data);
    if (!ok) return jsonError(404, "スポットが見つかりません");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { tripId, spotId } = await params;
  if (!isUuid(tripId) || !isUuid(spotId)) return jsonError(404, "スポットが見つかりません");
  try {
    await getStore().deleteSpot(tripId, spotId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { IdSchema } from "@/lib/export/schema";
import { ParticipantRowSchema } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const body = await parseBody(req, ParticipantRowSchema);
  if (!body.ok) return body.res;
  try {
    await getStore().upsertParticipant(tripId, body.data);
    return NextResponse.json(body.data);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const body = await parseBody(req, z.object({ id: IdSchema }));
  if (!body.ok) return body.res;
  try {
    await getStore().deleteParticipant(tripId, body.data.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

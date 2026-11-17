import { NextResponse } from "next/server";
import { z } from "zod";
import { IdSchema } from "@/lib/export/schema";
import { PhotoRowSchema } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, requireTripWriteAccess, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const denied = await requireTripWriteAccess(req, tripId);
  if (denied) return denied;
  const body = await parseBody(req, PhotoRowSchema);
  if (!body.ok) return body.res;
  try {
    await getStore().createPhoto(tripId, body.data);
    return NextResponse.json(body.data, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const denied = await requireTripWriteAccess(req, tripId);
  if (denied) return denied;
  const body = await parseBody(req, z.object({ id: IdSchema }));
  if (!body.ok) return body.res;
  try {
    await getStore().deletePhoto(tripId, body.data.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

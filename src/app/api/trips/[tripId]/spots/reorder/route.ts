import { NextResponse } from "next/server";
import { ReorderSpotsInput } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, requireTripWriteAccess, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const denied = await requireTripWriteAccess(req, tripId);
  if (denied) return denied;
  const body = await parseBody(req, ReorderSpotsInput);
  if (!body.ok) return body.res;
  try {
    await getStore().reorderSpots(tripId, body.data.day_index, body.data.ordered_ids);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

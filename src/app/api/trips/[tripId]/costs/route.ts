import { NextResponse } from "next/server";
import { z } from "zod";
import { IdSchema } from "@/lib/export/schema";
import { CostRowSchema } from "@/lib/model/types";
import { normalizeCostBreakdown } from "@/lib/costs/line-items";
import { getStore, isUuid, jsonError, parseBody, requireTripWriteAccess, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const denied = await requireTripWriteAccess(req, tripId);
  if (denied) return denied;
  const body = await parseBody(req, CostRowSchema);
  if (!body.ok) return body.res;
  try {
    // line_items がある費用は individual_breakdown をサーバー側でも導出し直す（二重管理の防止）
    const doc = await getStore().getTripDoc(tripId);
    if (!doc) return jsonError(404, "旅行が見つかりません");
    const cost = normalizeCostBreakdown(body.data, doc.participants);
    await getStore().upsertCost(tripId, cost);
    return NextResponse.json(cost);
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
    await getStore().deleteCost(tripId, body.data.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

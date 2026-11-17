import { NextResponse } from "next/server";
import { DayRowSchema, UpsertDayInput, type DayRow } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string; dayIndex: string }> };

/** 日程の作成・更新（出発地点・出発時刻など） */
export async function PUT(req: Request, { params }: Ctx) {
  const { tripId, dayIndex: raw } = await params;
  const dayIndex = Number(raw);
  if (!isUuid(tripId) || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 60)
    return jsonError(404, "日程が見つかりません");
  const body = await parseBody(req, UpsertDayInput);
  if (!body.ok) return body.res;
  try {
    const store = getStore();
    const doc = await store.getTripDoc(tripId);
    if (!doc) return jsonError(404, "旅行が見つかりません");
    const base: DayRow = doc.days.find((d) => d.day_index === dayIndex) ?? {
      day_index: dayIndex,
      label: dayIndex === 0 ? "出発前" : `Day ${dayIndex}`,
      date: null,
      departure_point: null,
      departure_lat: null,
      departure_lng: null,
      departure_time: null,
    };
    const merged = DayRowSchema.parse({ ...base, ...body.data, day_index: dayIndex });
    await store.upsertDay(tripId, merged);
    return NextResponse.json(merged);
  } catch (e) {
    return serverError(e);
  }
}

import { NextResponse } from "next/server";
import { CreateTripInput, initialDays } from "@/lib/model/types";
import { getStore, parseBody, serverError } from "@/lib/server";

/** 新しい旅行しおりを作成 → { id } */
export async function POST(req: Request) {
  const body = await parseBody(req, CreateTripInput);
  if (!body.ok) return body.res;
  try {
    const id = crypto.randomUUID();
    const { title, start_date, end_date } = body.data;
    await getStore().createTrip({ id, title, start_date, end_date, notes: "" }, initialDays(start_date, end_date));
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}

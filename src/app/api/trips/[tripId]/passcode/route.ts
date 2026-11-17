import { NextResponse } from "next/server";
import { VerifyPasscodeInput } from "@/lib/model/types";
import { getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";

type Ctx = { params: Promise<{ tripId: string }> };

/** 4桁の合言葉（パスコード）の照合 */
export async function POST(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  const body = await parseBody(req, VerifyPasscodeInput);
  if (!body.ok) return body.res;
  try {
    const ok = await getStore().verifyTripPasscode(tripId, body.data.passcode);
    if (!ok) return jsonError(403, "合言葉が一致しません");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}

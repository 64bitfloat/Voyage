import { NextResponse } from "next/server";
import { VerifyPasscodeInput } from "@/lib/model/types";
import { getClientIp, getStore, isUuid, jsonError, parseBody, serverError } from "@/lib/server";
import { checkRateLimit, createUnlockToken, getUnlockCookieName } from "@/lib/server/passcode";

type Ctx = { params: Promise<{ tripId: string }> };

/** 4桁の合言葉（パスコード）の照合＋HttpOnly署名Cookie発行 */
export async function POST(req: Request, { params }: Ctx) {
  const { tripId } = await params;
  if (!isUuid(tripId)) return jsonError(404, "旅行が見つかりません");
  if (!checkRateLimit(`passcode:${getClientIp(req)}:${tripId}`, 8, 60_000)) {
    return jsonError(429, "試行回数が多すぎます。1分ほど待ってから再度お試しください");
  }
  const body = await parseBody(req, VerifyPasscodeInput);
  if (!body.ok) return body.res;
  try {
    const ok = await getStore().verifyTripPasscode(tripId, body.data.passcode);
    if (!ok) return jsonError(403, "合言葉が一致しません");
    const res = NextResponse.json({ ok: true });
    res.cookies.set(getUnlockCookieName(tripId), createUnlockToken(tripId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return serverError(e);
  }
}

import { NextResponse } from "next/server";
import { CreateTripInput, initialDays } from "@/lib/model/types";
import { getStore, parseBody, serverError } from "@/lib/server";
import { createUnlockToken, getUnlockCookieName, hashPasscode } from "@/lib/server/passcode";

/** 新しい旅行しおりを作成 → { id } + HttpOnly署名Cookie発行 */
export async function POST(req: Request) {
  const body = await parseBody(req, CreateTripInput);
  if (!body.ok) return body.res;
  try {
    const id = crypto.randomUUID();
    const { title, start_date, end_date, passcode } = body.data;
    const passcodeHash = hashPasscode(passcode);
    await getStore().createTrip(
      { id, title, start_date, end_date, notes: "" },
      initialDays(start_date, end_date),
      passcodeHash,
    );
    const res = NextResponse.json({ id }, { status: 201 });
    res.cookies.set(getUnlockCookieName(id), createUnlockToken(id), {
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

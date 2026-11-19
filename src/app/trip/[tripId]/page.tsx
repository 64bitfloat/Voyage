import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TripWorkspaceClient from "@/components/TripWorkspaceClient";
import { getStore, isUuid } from "@/lib/server";
import { getUnlockCookieName, verifyUnlockToken } from "@/lib/server/passcode";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tripId: string }>;
}

/**
 * 部屋ページ (/trip/[tripId])
 * - 部屋URLを直接開いた場合や、合言葉の認証Cookieがない・部屋が存在しない場合はすべてトップページ (/) へリダイレクトする。
 * - トップページで「部屋ID」と「合言葉」を入力して認証を通過した場合のみ閲覧できる。
 */
export default async function TripPage({ params }: PageProps) {
  const { tripId } = await params;
  if (!isUuid(tripId)) redirect("/");

  const cookieStore = await cookies();
  const unlockToken = cookieStore.get(getUnlockCookieName(tripId))?.value;
  if (!verifyUnlockToken(tripId, unlockToken)) {
    redirect("/");
  }

  const store = getStore();
  let doc: Awaited<ReturnType<typeof store.getTripDoc>> = null;
  try {
    doc = await store.getTripDoc(tripId);
  } catch (e) {
    console.error("[voyage] getTripDoc error:", e);
  }

  if (!doc) {
    redirect("/");
  }

  return <TripWorkspaceClient initialDoc={doc} />;
}

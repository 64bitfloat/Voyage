import { notFound } from "next/navigation";
import TripWorkspaceClient from "@/components/TripWorkspaceClient";
import { getStore, isUuid } from "@/lib/server";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripPage({ params }: PageProps) {
  const { tripId } = await params;
  if (!isUuid(tripId)) notFound();
  const store = getStore();
  let doc = await store.getTripDoc(tripId);
  if (!doc && store.kind === "memory") {
    const { initialDays } = await import("@/lib/model/types");
    await store.createTrip(
      {
        id: tripId,
        title: "精進レークサイドキャンプ",
        start_date: "2026-12-12",
        end_date: "2026-12-13",
        notes: "",
      },
      initialDays("2026-12-12", "2026-12-13"),
      null,
    );
    doc = await store.getTripDoc(tripId);
  }
  if (!doc) notFound();
  return <TripWorkspaceClient initialDoc={doc} />;
}

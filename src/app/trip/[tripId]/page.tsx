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
  let doc: Awaited<ReturnType<typeof store.getTripDoc>> = null;
  try {
    doc = await store.getTripDoc(tripId);
  } catch (e) {
    console.error("[voyage] getTripDoc error:", e);
  }
  if (!doc) {
    const { initialDays } = await import("@/lib/model/types");
    try {
      await store.createTrip(
        {
          id: tripId,
          title: "新しい旅行しおり",
          start_date: null,
          end_date: null,
          notes: "",
        },
        initialDays(null, null),
        null,
      );
      doc = await store.getTripDoc(tripId);
    } catch (e) {
      console.error("[voyage] auto-create fallback error:", e);
    }
  }
  if (!doc) {
    const { initialDays } = await import("@/lib/model/types");
    doc = {
      trip: {
        id: tripId,
        title: "新しい旅行しおり",
        start_date: null,
        end_date: null,
        notes: "",
        has_passcode: false,
      },
      days: initialDays(null, null),
      spots: [],
      participants: [],
      costs: [],
      belongings: [],
      dishes: [],
      photos: [],
    };
  }
  return <TripWorkspaceClient initialDoc={doc} />;
}

import { notFound } from "next/navigation";
import TripWorkspace from "@/components/TripWorkspace";
import { getStore, isUuid } from "@/lib/server";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripPage({ params }: PageProps) {
  const { tripId } = await params;
  if (!isUuid(tripId)) notFound();
  const doc = await getStore().getTripDoc(tripId);
  if (!doc) notFound();
  return <TripWorkspace initialDoc={doc} />;
}

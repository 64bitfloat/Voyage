"use client";

import dynamic from "next/dynamic";
import type { TripDoc } from "@/lib/model/types";

const TripWorkspace = dynamic(() => import("./TripWorkspace"), {
  ssr: false,
  loading: () => (
    <div className="h-dvh flex items-center justify-center bg-[#f5f6f8] text-xs font-bold text-slate-500">
      しおりを読み込み中...
    </div>
  ),
});

export default function TripWorkspaceClient({ initialDoc }: { initialDoc: TripDoc }) {
  return <TripWorkspace initialDoc={initialDoc} />;
}

"use client";

import { useSyncContext } from "@/lib/contexts/SyncContext";

export default function SyncProgressBar() {
  const { syncState } = useSyncContext();

  if (!syncState.isSyncing) return null;

  const percent =
    syncState.total > 0 ? (syncState.progress / syncState.total) * 100 : 15;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[3px] bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
        style={{
          width: `${percent}%`,
        }}
      />
    </div>
  );
}

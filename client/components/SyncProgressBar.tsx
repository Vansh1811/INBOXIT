"use client";

import { useSyncContext } from "@/lib/contexts/SyncContext";

export default function SyncProgressBar() {
  const { syncState } = useSyncContext();

  if (!syncState.isSyncing) return null;

  const percent =
    syncState.total > 0 ? (syncState.progress / syncState.total) * 100 : 15;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[2px] bg-zinc-900">
      <div
        className="h-full bg-blue-600 transition-all duration-500 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

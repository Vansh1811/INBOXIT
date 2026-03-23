"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";

interface SyncState {
  isSyncing: boolean;
  progress: number;
  total: number;
  hasMore: boolean;
}

interface SyncContextValue {
  syncState: SyncState;
  setSyncState: React.Dispatch<React.SetStateAction<SyncState>>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncContext() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSyncContext must be used within SyncProvider");
  return ctx;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    progress: 0,
    total: 0,
    hasMore: false,
  });

  return (
    <SyncContext.Provider value={{ syncState, setSyncState }}>
      {children}
    </SyncContext.Provider>
  );
}

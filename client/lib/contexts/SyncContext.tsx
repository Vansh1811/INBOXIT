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

export interface IncomingSync {
  syncId: string;
  timestamp: number;
  userId: string;
}

interface SyncContextValue {
  syncState: SyncState;
  setSyncState: React.Dispatch<React.SetStateAction<SyncState>>;
  incomingSyncs: Record<string, IncomingSync>;
  addIncomingSync: (sync: IncomingSync) => void;
  removeIncomingSync: (syncId: string) => void;
  clearIncomingSyncs: () => void;
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

  const [incomingSyncs, setIncomingSyncs] = useState<Record<string, IncomingSync>>({});

  const addIncomingSync = (sync: IncomingSync) => {
    setIncomingSyncs((prev) => ({ ...prev, [sync.syncId]: sync }));
  };

  const removeIncomingSync = (syncId: string) => {
    setIncomingSyncs((prev) => {
      const copy = { ...prev };
      delete copy[syncId];
      return copy;
    });
  };

  const clearIncomingSyncs = () => setIncomingSyncs({});

  return (
    <SyncContext.Provider value={{ syncState, setSyncState, incomingSyncs, addIncomingSync, removeIncomingSync, clearIncomingSyncs }}>
      {children}
    </SyncContext.Provider>
  );
}

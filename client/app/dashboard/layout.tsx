"use client";

import { useEffect, useCallback } from "react";
import { SocketProvider, useSocketContext } from "@/lib/contexts/SocketContext";
import { ToastProvider, useToast } from "@/lib/contexts/ToastContext";
import { SyncProvider, useSyncContext } from "@/lib/contexts/SyncContext";
import Sidebar from "@/components/Sidebar";
import SyncProgressBar from "@/components/SyncProgressBar";
import Toast from "@/components/Toast";
import api from "@/lib/api";

// ─── DASHBOARD INNER ─────────────────────────────────────────────────────────

function DashboardInner({ children }: { children: React.ReactNode }) {
  const { socket } = useSocketContext();
  const { addToast } = useToast();
  const { setSyncState, addIncomingSync, removeIncomingSync, clearIncomingSyncs } = useSyncContext();

  useEffect(() => {
    api.post("/sync").catch(() => {});
  }, []);

  const handleSyncStarted = useCallback(() => {
    setSyncState((prev) => ({ ...prev, isSyncing: true, progress: 0 }));
    addToast("Syncing your inbox…", "info");
  }, [setSyncState, addToast]);

  const handleSyncProgress = useCallback(
    (data: { saved: number; total: number }) => {
      setSyncState((prev) => ({ ...prev, progress: data.saved, total: data.total }));
    },
    [setSyncState]
  );

  const handleSyncComplete = useCallback(
    (data: { totalSynced: number; hasMore: boolean }) => {
      setSyncState({ isSyncing: false, progress: 0, total: 0, hasMore: data.hasMore });
      addToast(`Sync complete — ${data.totalSynced} emails loaded`, "success");
    },
    [setSyncState, addToast]
  );

  const handleSyncFailed = useCallback(
    (data: { error: string }) => {
      setSyncState((prev) => ({ ...prev, isSyncing: false }));
      clearIncomingSyncs();
      addToast(`Sync failed: ${data.error}`, "error");
    },
    [setSyncState, clearIncomingSyncs, addToast]
  );

  const handleSyncIncoming = useCallback(
    (data: { syncId: string; timestamp: number; userId: string }) => {
      addIncomingSync(data);
      // Failsafe: if sync:complete never arrives, remove this placeholder after 10 seconds
      setTimeout(() => {
        removeIncomingSync(data.syncId);
      }, 10000);
    },
    [addIncomingSync, removeIncomingSync]
  );

  useEffect(() => {
    if (!socket) return;
    socket.on("sync:started",  handleSyncStarted);
    socket.on("sync:progress", handleSyncProgress);
    socket.on("sync:complete", handleSyncComplete);
    socket.on("sync:failed",   handleSyncFailed);
    socket.on("sync:incoming", handleSyncIncoming);
    return () => {
      socket.off("sync:started",  handleSyncStarted);
      socket.off("sync:progress", handleSyncProgress);
      socket.off("sync:complete", handleSyncComplete);
      socket.off("sync:failed",   handleSyncFailed);
      socket.off("sync:incoming", handleSyncIncoming);
    };
  }, [socket, handleSyncStarted, handleSyncProgress, handleSyncComplete, handleSyncFailed, handleSyncIncoming]);

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col font-sans relative text-[var(--text-primary)]">
      {/* Content — z:1 */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <SyncProgressBar />

        <div className="flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <div className="hidden md:block shrink-0 h-screen bg-[var(--bg-sidebar)]">
            <Sidebar />
          </div>

          {/* Main (List + Detail) */}
          <main className="flex-1 overflow-hidden min-w-0 flex">
            {children}
          </main>
        </div>

        {/* Mobile bottom nav */}
        <div className="md:hidden">
          <Sidebar mobile />
        </div>

        <Toast />
      </div>
    </div>
  );
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

import { ActionProvider } from "@/lib/contexts/ActionContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ActionProvider>
        <SyncProvider>
          <SocketProvider>
            <DashboardInner>{children}</DashboardInner>
          </SocketProvider>
        </SyncProvider>
      </ActionProvider>
    </ToastProvider>
  );
}
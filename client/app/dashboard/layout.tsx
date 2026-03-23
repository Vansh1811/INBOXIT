"use client";

import { useEffect, useCallback } from "react";
import { SocketProvider, useSocketContext } from "@/lib/contexts/SocketContext";
import { ToastProvider, useToast } from "@/lib/contexts/ToastContext";
import { SyncProvider, useSyncContext } from "@/lib/contexts/SyncContext";
import Sidebar from "@/components/Sidebar";
import SyncProgressBar from "@/components/SyncProgressBar";
import Toast from "@/components/Toast";
import api from "@/lib/api";

// ─── AURORA BACKGROUND ────────────────────────────────────────────────────────
// Lives here so it persists through all route changes without remounting

function AuroraBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* Blob 1 — Blue, top-left */}
      <div style={{
        position: "absolute",
        width: "70vw", height: "65vh",
        top: "-20%", left: "-15%",
        background: "radial-gradient(ellipse, rgba(37,99,235,0.22) 0%, transparent 70%)",
        filter: "blur(72px)",
        animation: "aurora1 16s ease-in-out infinite",
      }} />

      {/* Blob 2 — Purple, bottom-right */}
      <div style={{
        position: "absolute",
        width: "55vw", height: "55vh",
        bottom: "-20%", right: "-10%",
        background: "radial-gradient(ellipse, rgba(139,92,246,0.17) 0%, transparent 70%)",
        filter: "blur(80px)",
        animation: "aurora2 20s ease-in-out infinite",
      }} />

      {/* Blob 3 — Cyan, center-right */}
      <div style={{
        position: "absolute",
        width: "40vw", height: "40vh",
        top: "30%", right: "10%",
        background: "radial-gradient(ellipse, rgba(6,182,212,0.11) 0%, transparent 70%)",
        filter: "blur(60px)",
        animation: "aurora3 24s ease-in-out infinite",
      }} />

      {/* Dot grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)",
        backgroundSize: "30px 30px",
        maskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 30%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 30%, transparent 100%)",
      }} />

      {/* Scanline sweep */}
      <div style={{
        position: "absolute", left: 0, right: 0, height: 3,
        background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.18), rgba(6,182,212,0.12), transparent)",
        animation: "scanline 9s linear infinite",
      }} />

      {/* SVG grain */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.3, mixBlendMode: "overlay" }}
        aria-hidden="true"
      >
        <filter id="db-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#db-grain)" opacity="0.45" />
      </svg>
    </div>
  );
}

// ─── DASHBOARD INNER ─────────────────────────────────────────────────────────

function DashboardInner({ children }: { children: React.ReactNode }) {
  const { socket } = useSocketContext();
  const { addToast } = useToast();
  const { setSyncState } = useSyncContext();

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
      addToast(`Sync failed: ${data.error}`, "error");
    },
    [setSyncState, addToast]
  );

  useEffect(() => {
    if (!socket) return;
    socket.on("sync:started",  handleSyncStarted);
    socket.on("sync:progress", handleSyncProgress);
    socket.on("sync:complete", handleSyncComplete);
    socket.on("sync:failed",   handleSyncFailed);
    return () => {
      socket.off("sync:started",  handleSyncStarted);
      socket.off("sync:progress", handleSyncProgress);
      socket.off("sync:complete", handleSyncComplete);
      socket.off("sync:failed",   handleSyncFailed);
    };
  }, [socket, handleSyncStarted, handleSyncProgress, handleSyncComplete, handleSyncFailed]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050508",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Figtree', -apple-system, sans-serif",
      position: "relative",
    }}>
      {/* Persistent aurora — z:0 */}
      <AuroraBackground />

      {/* Content — z:1 */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <SyncProgressBar />

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Desktop sidebar */}
          <div className="hidden md:block" style={{ flexShrink: 0 }}>
            <Sidebar />
          </div>

          {/* Main */}
          <main style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SyncProvider>
        <SocketProvider>
          <DashboardInner>{children}</DashboardInner>
        </SocketProvider>
      </SyncProvider>
    </ToastProvider>
  );
}
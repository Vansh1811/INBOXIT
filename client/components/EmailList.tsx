"use client";

import { useState, useEffect } from "react";
import { useEmails, Email } from "@/lib/hooks/useEmails";
import { useSocketContext } from "@/lib/contexts/SocketContext";
import { useToast } from "@/lib/contexts/ToastContext";
import { useSyncContext } from "@/lib/contexts/SyncContext";
import { CAT } from "@/lib/utils/email";
import { mutate as globalMutate } from "swr";
import EmailDetail from "@/components/EmailDetail";
import EmailListHeader from "@/components/EmailListHeader";
import EmptyEmailState from "@/components/EmptyEmailState";
import EmailRow from "@/components/EmailRow";
import PulsePlaceholder from "@/components/PulsePlaceholder";
import BulkToolbar from "@/components/BulkToolbar";
import api from "@/lib/api";
import { ChevronLeft } from "lucide-react";
import { useActionContext } from "@/lib/contexts/ActionContext";

interface EmailListProps { folder: string; }

export default function EmailList({ folder }: EmailListProps) {
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery]         = useState("");
  // Keyset pagination state: cursorStack[i] = cursor used to fetch page i
  // (stack[0] = "" = first page). Reset whenever folder or search changes.
  const [cursorStack, setCursorStack]         = useState<string[]>([""]);
  const [pageIndex, setPageIndex]             = useState(0);
  // Last known total (only first-page payloads carry one)
  const [lastTotal, setLastTotal]             = useState(0);
  const [isSyncingMore, setIsSyncingMore]     = useState(false);

  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);

  const limit = 50;
  const { addToast } = useToast();
  const { socket }   = useSocketContext();
  const { incomingSyncs, clearIncomingSyncs } = useSyncContext();
  const { addPendingActions, removePendingAction, pendingActions, addPendingAction } = useActionContext();
  const cursor = cursorStack[Math.min(pageIndex, cursorStack.length - 1)] ?? "";
  const { emails, hasMore, nextCursor, freshTotal, isLoading, error, mutate } =
    useEmails(folder, cursor, searchQuery, limit);

  // Keep the last known total when a fresh one arrives (first pages only).
  useEffect(() => {
    if (freshTotal !== null) setLastTotal(freshTotal);
  }, [freshTotal]);

  // O-H2: partial ingestion must be visible, not silent.
  useEffect(() => {
    if (!socket) return;
    const onPartial = (data: { errors?: number; message?: string }) => {
      addToast(data?.message || "Some emails couldn't be loaded.", "warning");
    };
    socket.on("sync:partial", onPartial);
    return () => { socket.off("sync:partial", onPartial); };
  }, [socket, addToast]);

  useEffect(() => {
    setCursorStack([""]);
    setPageIndex(0);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
    setLastSelectedIdx(null);
  }, [folder, searchQuery]);

  useEffect(() => {
    if (!socket) return;
    const onComplete = async () => {
      await mutate();
      setIsSyncingMore(false);
      clearIncomingSyncs();
    };
    socket.on("sync:complete", onComplete);
    return () => { socket.off("sync:complete", onComplete); };
  }, [socket, mutate, clearIncomingSyncs]);

  const safeTotalCount = Math.max(lastTotal, pageIndex * limit + emails.length);
  const startCount     = safeTotalCount === 0 ? 0 : pageIndex * limit + 1;
  const endCount       = Math.min(pageIndex * limit + limit, safeTotalCount);

  const handleNextPage = async () => {
    if (!hasMore || !nextCursor) {
      // End of local dataset → pull older mail from Gmail; sync:complete
      // refetches the current page via mutate().
      setIsSyncingMore(true);
      try {
        await api.post("/sync/load-more");
        addToast("Fetching older emails from Gmail…", "info");
      } catch {
        addToast("Failed to fetch older emails.", "error");
        setIsSyncingMore(false);
      }
      return;
    }
    if (pageIndex + 1 < cursorStack.length) {
      setPageIndex(pageIndex + 1); // revisiting an already-fetched page (cache hit)
    } else {
      setCursorStack((s) => [...s, nextCursor]); // append new page cursor
      setPageIndex(pageIndex + 1);
    }
  };

  const handlePrevPage = () => setPageIndex((p) => Math.max(0, p - 1));

  const [focusedEmailId, setFocusedEmailId]   = useState<string | null>(null);

  useEffect(() => {
    // If no focus and we have emails, set focus to first
    if (!focusedEmailId && emails.length > 0) {
      setFocusedEmailId(emails[0]._id);
    }
  }, [emails, focusedEmailId]);

  const handleRowClick = (e: React.MouseEvent, emailId: string, idx: number) => {
    setFocusedEmailId(emailId);
    if (e.shiftKey && lastSelectedIdx !== null) {
      // Range select
      const start = Math.min(lastSelectedIdx, idx);
      const end = Math.max(lastSelectedIdx, idx);
      const newSelected = new Set(selectedIds);
      for (let i = start; i <= end; i++) {
        if (emails[i]) newSelected.add(emails[i]._id);
      }
      setSelectedIds(newSelected);
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle
      const newSelected = new Set(selectedIds);
      if (newSelected.has(emailId)) newSelected.delete(emailId);
      else newSelected.add(emailId);
      setSelectedIds(newSelected);
      setLastSelectedIdx(idx);
    } else {
      // Normal click
      setSelectedEmailId(emailId);
    }
  };

  const getNextFocusId = (currentIdx: number, ignoreIds: Set<string> = new Set()) => {
    // Try searching down
    for (let i = currentIdx + 1; i < emails.length; i++) {
      const id = emails[i]._id;
      if (!pendingActions[id] && !ignoreIds.has(id)) return id;
    }
    // Try searching up
    for (let i = currentIdx - 1; i >= 0; i--) {
      const id = emails[i]._id;
      if (!pendingActions[id] && !ignoreIds.has(id)) return id;
    }
    return null;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // Cmd/Ctrl + A
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(emails.map((em: Email) => em._id)));
        return;
      }

      // Search Focus
      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
        return;
      }

      // Detail view shortcuts
      if (selectedEmailId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setSelectedEmailId(null);
        }
        return;
      }

      // List view shortcuts
      const currentIdx = emails.findIndex((em: Email) => em._id === focusedEmailId);
      
      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          e.preventDefault();
          const nextId = getNextFocusId(currentIdx);
          if (nextId && emails.findIndex((e: Email) => e._id === nextId) > currentIdx) {
            setFocusedEmailId(nextId);
            document.getElementById(`email-row-${nextId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault();
          // To search up, we need a custom search
          let prevId = null;
          for (let i = currentIdx - 1; i >= 0; i--) {
            if (!pendingActions[emails[i]._id]) {
              prevId = emails[i]._id;
              break;
            }
          }
          if (prevId) {
            setFocusedEmailId(prevId);
            document.getElementById(`email-row-${prevId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (focusedEmailId) setSelectedEmailId(focusedEmailId);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setSelectedIds(new Set());
          break;
        }
        case 'e': {
          e.preventDefault();
          if (!focusedEmailId) break;
          const nextFocus = getNextFocusId(currentIdx, new Set([focusedEmailId]));
          
          // Action
          const id = focusedEmailId;
          addPendingAction(id, "archive");
          if (nextFocus) setFocusedEmailId(nextFocus);
          
          api.post(`/api/emails/${id}/archive`).then(res => {
            const jobId = res.data?.jobId;
            globalMutate("/api/emails/counts/unread");
            addToast("Archived", "info", {
              label: "Undo", countdown: 5,
              onClick: async () => {
                if (!jobId) return;
                try {
                  await api.post(`/api/emails/${id}/cancel-action`, { jobId });
                  globalMutate("/api/emails/counts/unread");
                  removePendingAction(id);
                } catch {}
              }
            });
          }).catch(() => removePendingAction(id));
          break;
        }
        case '#': {
          e.preventDefault();
          if (!focusedEmailId) break;
          const nextFocus = getNextFocusId(currentIdx, new Set([focusedEmailId]));
          
          // Action
          const id = focusedEmailId;
          addPendingAction(id, "delete");
          if (nextFocus) setFocusedEmailId(nextFocus);
          
          api.delete(`/api/emails/${id}`).then(res => {
            const jobId = res.data?.jobId;
            globalMutate("/api/emails/counts/unread");
            addToast("Deleted", "info", {
              label: "Undo", countdown: 5,
              onClick: async () => {
                if (!jobId) return;
                try {
                  await api.post(`/api/emails/${id}/cancel-action`, { jobId });
                  globalMutate("/api/emails/counts/unread");
                  removePendingAction(id);
                } catch {}
              }
            });
          }).catch(() => removePendingAction(id));
          break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [emails, focusedEmailId, selectedEmailId, selectedIds, addPendingAction, removePendingAction, addToast, pendingActions]);

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    
    addPendingActions(ids, "archive");
    setSelectedIds(new Set());
    
    // update focus if focused item is archived
    if (focusedEmailId && ids.includes(focusedEmailId)) {
      const currentIdx = emails.findIndex((em: Email) => em._id === focusedEmailId);
      const nextFocus = getNextFocusId(currentIdx, new Set(ids));
      if (nextFocus) setFocusedEmailId(nextFocus);
    }
    
    try {
      const res = await api.post(`/api/emails/bulk/archive`, { ids });
      const jobId = res.data?.jobId;
      globalMutate("/api/emails/counts/unread");
      
      const toastId = Math.random().toString(36).slice(2, 9);
      addToast(`Archived ${ids.length} emails`, "info", {
        label: "Undo",
        countdown: 5,
        onClick: async () => {
          if (!jobId) return;
          try {
            await api.post(`/api/emails/bulk/cancel-action`, { jobId }); 
            globalMutate("/api/emails/counts/unread"); 
            ids.forEach(id => removePendingAction(id));
            addToast("Bulk action undone. Emails restored.", "success");
          } catch (err: any) {
             if (err.response?.status === 409) {
               addToast("Too late — the action has already completed.", "error");
             }
          }
        }
      });
    } catch {
       ids.forEach(id => removePendingAction(id));
    }
  };

  // We will refine the bulk undo in a moment.

  // ── DETAIL VIEW ─────────────────────────────────────────────────────────────

  if (selectedEmailId) {
    return (
      <div className="flex flex-col flex-1 h-screen overflow-hidden bg-zinc-950">
        {/* Back bar */}
        <div className="flex items-center px-4 h-12 shrink-0 bg-zinc-950 border-b border-zinc-800">
          <button
            onClick={() => setSelectedEmailId(null)}
            className="flex items-center gap-2 text-zinc-400 bg-transparent border-none text-[13px] cursor-pointer px-2 py-1 rounded transition-colors duration-100 hover:text-zinc-50 hover:bg-zinc-900 outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            Back to {folder.charAt(0).toUpperCase() + folder.slice(1)}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <EmailDetail
            emailId={selectedEmailId}
            onClose={() => setSelectedEmailId(null)}
            onEmailUpdated={() => {
              mutate();
              globalMutate("/api/emails/counts/unread");
            }}
          />
        </div>
      </div>
    );
  }

  // ── LIST VIEW ───────────────────────────────────────────────────────────────

  const folderCat = CAT[folder === "inbox" ? "uncategorized" : folder] ?? CAT.uncategorized;

  return (
    <div className="flex flex-col h-screen w-full min-w-0 bg-[var(--bg-inbox)]">
      <EmailListHeader
        folder={folder}
        safeTotalCount={safeTotalCount}
        startCount={startCount}
        endCount={endCount}
        isSyncingMore={isSyncingMore}
        isLoading={isLoading}
        canGoPrev={pageIndex > 0}
        setSearchQuery={setSearchQuery}
        handlePrevPage={handlePrevPage}
        handleNextPage={handleNextPage}
      />

      {/* ── ROWS ── */}
      <div className="flex-1 overflow-y-auto">
        {error && emails.length === 0 ? (
          /* O-H2: a failed load must never read as "caught up" */
          <EmptyEmailState type="error" onRetry={() => mutate()} />
        ) : isLoading && emails.length === 0 ? (
          <EmptyEmailState type="loading" />
        ) : emails.length === 0 ? (
          <EmptyEmailState type="empty" folder={folder} iconName={folderCat.icon} />
        ) : (
          <div className="flex flex-col relative">
            <PulsePlaceholder 
              active={Object.keys(incomingSyncs).length > 0} 
              count={Object.keys(incomingSyncs).length} 
            />
            {emails.map((email: Email, idx: number) => (
              <EmailRow
                key={email._id}
                id={`email-row-${email._id}`}
                email={email}
                idx={idx}
                isSelected={selectedIds.has(email._id)}
                isFocused={focusedEmailId === email._id}
                pendingAction={pendingActions[email._id]}
                onClick={(e) => handleRowClick(e, email._id, idx)}
              />
            ))}
          </div>
        )}
      </div>

      <BulkToolbar 
        selectedCount={selectedIds.size}
        onArchive={handleBulkArchive}
        onDelete={async () => {
          const ids = Array.from(selectedIds);
          if (!ids.length) return;
          
          addPendingActions(ids, "delete");
          setSelectedIds(new Set());
          
          if (focusedEmailId && ids.includes(focusedEmailId)) {
            const currentIdx = emails.findIndex((em: Email) => em._id === focusedEmailId);
            const nextFocus = getNextFocusId(currentIdx, new Set(ids));
            if (nextFocus) setFocusedEmailId(nextFocus);
          }
          
          try {
            const res = await api.post(`/api/emails/bulk/delete`, { ids });
            const jobId = res.data?.jobId; // Let's return jobId from backend
            globalMutate("/api/emails/counts/unread");
            
            addToast(`Deleted ${ids.length} emails`, "info", {
              label: "Undo",
              countdown: 5,
              onClick: async () => {
                if (!jobId) return;
                try {
                  await api.post(`/api/emails/bulk/cancel-action`, { jobId }); 
            globalMutate("/api/emails/counts/unread");
                  ids.forEach(id => removePendingAction(id));
                  addToast("Bulk action undone. Emails restored.", "success");
                } catch (err: any) {
                  if (err.response?.status === 409) {
                    addToast("Too late — the action has already completed.", "error");
                  }
                }
              }
            });
          } catch {
             ids.forEach(id => removePendingAction(id));
          }
        }}
        onCancel={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
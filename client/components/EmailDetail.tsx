"use client";

import { useState, useEffect, useMemo } from "react";
import api from "@/lib/api";
import DOMPurify from "dompurify";
import { CAT, stripHtml } from "@/lib/utils/email";
import EmailDetailToolbar from "./EmailDetailToolbar";
import EmailDetailHeader from "./EmailDetailHeader";
import EmailDetailBody from "./EmailDetailBody";
import { Loader2, Archive, Trash2, ArrowLeft } from "lucide-react";
import { useToast } from "@/lib/contexts/ToastContext";
import { useActionContext } from "@/lib/contexts/ActionContext";

interface EmailDetailData {
  _id: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  category: string;
}

interface EmailDetailProps {
  emailId: string;
  onClose: () => void;
  onEmailUpdated: () => void;
}

export default function EmailDetail({ emailId, onClose, onEmailUpdated }: EmailDetailProps) {
  const [email, setEmail]     = useState<EmailDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const hasHtml = useMemo(() => {
    if (!email?.bodyHtml) return false;
    return stripHtml(email.bodyHtml).length >= 20;
  }, [email?.bodyHtml]);

  const safeHtml = useMemo(() => {
    if (!email?.bodyHtml) return "";
    return DOMPurify.sanitize(email.bodyHtml, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "form", "object"],
      ADD_ATTR: ["target"],
    });
  }, [email?.bodyHtml]);

  useEffect(() => {
    setLoading(true); setError(null);
    api.get(`/api/emails/${emailId}`)
      .then((res) => {
        setEmail(res.data);
        if (!res.data.isRead) {
          api.patch(`/api/emails/${emailId}`, { isRead: true }).then(() => onEmailUpdated());
        }
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load email"))
      .finally(() => setLoading(false));
  }, [emailId, onEmailUpdated]);

  const toggle = async (field: "isStarred" | "isRead") => {
    if (!email) return;
    try {
      await api.patch(`/api/emails/${email._id}`, { [field]: !email[field] });
      setEmail((p) => p ? { ...p, [field]: !p[field] } : p);
      onEmailUpdated();
    } catch {}
  };

  const { addToast } = useToast();
  const { addPendingAction, removePendingAction } = useActionContext();

  const handleArchive = async () => {
    if (!email) return;
    try {
      addPendingAction(email._id, "archive");
      onClose(); // Hide detail view
      await api.post(`/api/emails/${email._id}/archive`);
      
      let secondsLeft = 5;
      const toastId = Math.random().toString(36).slice(2, 9);
      
      // We'll handle the countdown in a custom toast logic or just update the message.
      // Wait, ToastContext doesn't have an updateToast method.
      // Let's modify ToastContext to support a duration, or just rely on the static text.
      // Ah, the user requested "Undo (5) -> Undo (4) ...".
      // Let's pass a `countdown` property to the action, which Toast component will use to render the number.
      
      addToast(`Archived "${email.subject}"`, "info", {
        label: "Undo",
        countdown: 5,
        onClick: async () => {
          try {
            await api.post(`/api/emails/${email._id}/cancel-action`, { action: "archive" });
            removePendingAction(email._id);
            addToast("Action undone. Email restored.", "success");
          } catch (err: any) {
            if (err.response?.status === 409) {
              addToast("Too late — the action has already completed.", "error");
            } else {
              console.error(err);
            }
          }
        }
      });
    } catch {
      removePendingAction(email._id);
    }
  };

  const handleDelete = async () => {
    if (!email) return;
    try {
      addPendingAction(email._id, "delete");
      onClose(); // Hide detail view
      await api.delete(`/api/emails/${email._id}`);
      
      addToast(`Deleted "${email.subject}"`, "info", {
        label: "Undo",
        countdown: 5,
        onClick: async () => {
          try {
            await api.post(`/api/emails/${email._id}/cancel-action`, { action: "delete" });
            removePendingAction(email._id);
            addToast("Action undone. Email restored.", "success");
          } catch (err: any) {
            if (err.response?.status === 409) {
              addToast("Too late — the action has already completed.", "error");
            } else {
              console.error(err);
            }
          }
        }
      });
    } catch {
      removePendingAction(email._id);
    }
  };

  const formattedDate = email
    ? new Date(email.receivedAt).toLocaleString("en-IN", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    : "";

  const cat = CAT[email?.category ?? "uncategorized"] ?? CAT.uncategorized;

  // ── LOADING ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" strokeWidth={1.5} />
        <span className="font-mono text-[11px] text-zinc-500 tracking-wide uppercase">
          Loading email…
        </span>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <span className="text-[32px]">⚠️</span>
        <p className="text-red-400 text-[13px]">{error || "Email not found"}</p>
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-[12px] text-zinc-400 hover:text-zinc-50 bg-transparent border-none cursor-pointer font-mono outline-none"
        >
          <ArrowLeft className="w-3 h-3" strokeWidth={1.5} /> go back
        </button>
      </div>
    );
  }

  // ── MAIN ─────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)] p-4 md:p-8 overflow-hidden animate-slide-in">
      <div className="flex-1 max-w-[800px] w-full mx-auto bg-[var(--bg-reading)] shadow-paper rounded-md flex flex-col overflow-hidden relative">
        {/* ── SCROLL AREA ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[65ch] mx-auto pt-16 px-8 pb-32">
            <EmailDetailHeader email={email} cat={cat} formattedDate={formattedDate} />
            <EmailDetailBody email={email} cat={cat} hasHtml={hasHtml} safeHtml={safeHtml} />

            {/* Bottom action strip */}
            <div className="mt-16 pt-8 border-t border-[var(--border-subtle)]">
              <EmailDetailToolbar
                email={email}
                cat={cat}
                onClose={onClose}
                toggle={toggle}
                handleArchive={handleArchive}
                handleDelete={handleDelete}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
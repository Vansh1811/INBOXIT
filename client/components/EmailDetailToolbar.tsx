"use client";

import { cn } from "@/lib/utils/cn";
import { ChevronLeft, MailOpen, Mail, Star, Archive, Trash2 } from "lucide-react";

interface EmailDetailToolbarProps {
  email: any;
  cat: any;
  onClose: () => void;
  toggle: (field: "isStarred" | "isRead") => void;
  handleArchive: () => void;
  handleDelete: () => void;
}

export default function EmailDetailToolbar({
  email,
  cat,
  onClose,
  toggle,
  handleArchive,
  handleDelete,
}: EmailDetailToolbarProps) {
  return (
    <div className="flex items-center justify-between h-14 shrink-0 bg-transparent">
      
      {/* Back / Close */}
      <div className="flex gap-4">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-[var(--text-secondary)] bg-transparent border-none text-[13px] font-medium cursor-pointer py-1 transition-colors duration-100 hover:text-[var(--text-primary)] outline-none"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
          Back
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <a
          href={`mailto:${email.from}?subject=Re: ${encodeURIComponent(email.subject || "")}`}
          className="flex items-center justify-center h-8 px-3 rounded border-none bg-[var(--text-primary)] text-[var(--bg-base)] text-[13px] font-medium cursor-pointer transition-colors duration-100 hover:bg-[var(--accent)] outline-none no-underline"
        >
          Reply
        </a>
        
        <div className="w-px h-4 bg-[var(--border-subtle)] mx-2" />
        <button
          className="flex items-center justify-center w-8 h-8 rounded border-none bg-transparent text-[var(--text-secondary)] cursor-pointer transition-colors duration-100 hover:text-[var(--text-primary)] hover:bg-[var(--hover)] outline-none"
          onClick={() => toggle("isRead")}
          title={email.isRead ? "Mark unread" : "Mark read"}
        >
          {email.isRead ? (
            <Mail className="w-4 h-4" strokeWidth={1.5} />
          ) : (
            <MailOpen className="w-4 h-4" strokeWidth={1.5} />
          )}
        </button>

        <button
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded border-none bg-transparent cursor-pointer transition-colors duration-100 hover:bg-[var(--hover)] outline-none",
            email.isStarred ? "text-[#F59E0B]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
          onClick={() => toggle("isStarred")}
          title={email.isStarred ? "Unstar" : "Star"}
        >
          <Star 
            className="w-4 h-4" 
            fill={email.isStarred ? "currentColor" : "none"} 
            strokeWidth={1.5} 
          />
        </button>

        <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />

        <button
          className="flex items-center justify-center w-8 h-8 rounded border-none bg-transparent text-[var(--text-secondary)] cursor-pointer transition-colors duration-100 hover:text-[var(--accent)] hover:bg-[var(--hover)] outline-none"
          onClick={handleArchive}
          title="Archive"
        >
          <Archive className="w-4 h-4" strokeWidth={1.5} />
        </button>

        <button
          className="flex items-center justify-center w-8 h-8 rounded border-none bg-transparent text-[var(--text-secondary)] cursor-pointer transition-colors duration-100 hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 outline-none"
          onClick={handleDelete}
          title="Delete"
        >
          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

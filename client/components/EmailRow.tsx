import { memo } from "react";
import { CAT, senderInitial, senderName, formatTime } from "@/lib/utils/email";
import { cn } from "@/lib/utils/cn";
import { Star } from "lucide-react";
import { Email } from "@/lib/hooks/useEmails";

interface EmailRowProps {
  id: string;
  email: Email;
  idx: number;
  isSelected: boolean;
  isFocused: boolean;
  pendingAction?: string;
  onClick: (e: React.MouseEvent) => void;
}

export default memo(function EmailRow({ id, email, idx, isSelected, isFocused, pendingAction, onClick }: EmailRowProps) {
  const cat = CAT[email.category] ?? CAT.uncategorized;

  return (
    <button
      id={id}
      onClick={onClick}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      className={cn(
        "group grid grid-cols-[16px_220px_minmax(0,1fr)_auto_120px] items-center gap-4 px-6 w-full text-left bg-transparent border-b cursor-pointer relative transition-all duration-150 ease-out outline-none overflow-hidden",
        pendingAction === "archive" ? "-translate-x-full opacity-0 h-0 min-h-0 py-0 border-transparent mb-0" :
        pendingAction === "delete" ? "scale-95 opacity-0 h-0 min-h-0 py-0 border-transparent mb-0" :
        "h-[48px] border-[var(--border-subtle)] hover:bg-[var(--hover)]",
        isSelected && !pendingAction ? "bg-[var(--hover)]" : "bg-transparent",
        isFocused && !pendingAction ? "ring-inset ring-2 ring-[var(--accent)] z-10" : ""
      )}
    >
      {/* Selection Left Accent Bar */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--accent)] transition-opacity",
        isSelected ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
      )} />

      {/* 1. Unread Dot */}
      <div className="flex items-center justify-center">
        <div
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-100",
            !email.isRead ? "bg-[var(--accent)]" : "bg-transparent"
          )}
        />
      </div>

      {/* 2. Sender (largest) */}
      <div className="flex items-center gap-3 overflow-hidden">
        <span
          className={cn(
            "text-[15px] tracking-tight overflow-hidden text-ellipsis whitespace-nowrap",
            !email.isRead ? "font-semibold text-[var(--text-primary)]" : "font-normal text-[var(--text-secondary)]"
          )}
        >
          {senderName(email.from)}
        </span>
      </div>

      {/* 3. Subject (medium) + 4. Snippet (muted) */}
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <span
          className={cn(
            "text-[14px] tracking-tight shrink-0 max-w-[45%] overflow-hidden text-ellipsis whitespace-nowrap",
            !email.isRead ? "font-medium text-[var(--text-primary)]" : "font-normal text-[var(--text-secondary)]"
          )}
        >
          {email.subject || "(no subject)"}
        </span>
        <span className="text-[14px] text-[var(--text-muted)] tracking-tight overflow-hidden text-ellipsis whitespace-nowrap">
          {email.snippet}
        </span>
      </div>

      {/* Category Chip */}
      <div className="flex items-center justify-end shrink-0">
        {email.category !== "uncategorized" && cat && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
            {cat.label}
          </span>
        )}
      </div>

      {/* 5. Time (mono) */}
      <div className="flex items-center justify-end shrink-0">
        <span
          className={cn(
            "font-mono text-[12px] whitespace-nowrap text-right",
            !email.isRead ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-muted)]"
          )}
        >
          {formatTime(email.receivedAt)}
        </span>
      </div>
    </button>
  );
});

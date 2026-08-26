"use client";

import { senderInitial, senderName, senderEmail, CategoryMeta } from "@/lib/utils/email";
import {
  Inbox, Briefcase, Bell, CreditCard, Car, Plane, Pizza,
  ShoppingBag, Pill, GraduationCap, Newspaper, User, Tag
} from "lucide-react";
import { EmailDetailData } from "./EmailDetail";

const ICON_MAP: Record<string, React.ElementType> = {
  Inbox, Briefcase, Bell, CreditCard, Car, Plane, Pizza,
  ShoppingBag, Pill, GraduationCap, Newspaper, User, Tag
};

const PROVENANCE_LABELS: Record<string, string> = {
  rule: "Auto-sorted",
  preference: "Learned from your corrections",
  context: "Sorted by context",
  ai: "AI-assisted",
  user: "Moved by you",
  default: "Default sorting",
  error_fallback: "Default sorting",
};

interface EmailDetailHeaderProps {
  email: EmailDetailData;
  cat: CategoryMeta;
  formattedDate: string;
}

export default function EmailDetailHeader({ email, cat, formattedDate }: EmailDetailHeaderProps) {
  const Icon = ICON_MAP[cat.icon] || Inbox;
  const provenance = email.classificationSource ? PROVENANCE_LABELS[email.classificationSource] : null;

  return (
    <div className="mb-8">
      {/* Subject */}
      <h1 className="text-[28px] font-semibold text-[var(--text-primary)] tracking-tight leading-[1.3] mb-8">
        {email.subject || "(no subject)"}
      </h1>

      <div className="border-t border-b border-[var(--border-subtle)] py-4 my-6">
        <div className="flex flex-col gap-2">

          {email.category !== "uncategorized" && (
            <div className="flex gap-4 items-baseline mb-2">
              <span className="w-12 text-[12px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">Folder</span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] text-[12px] font-medium">
                  <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                  {cat.label}
                </span>
                {provenance && (
                  <span className="text-[12px] text-[var(--text-muted)] italic">
                    — {provenance}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-4 items-baseline">
            <span className="w-12 text-[12px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">From</span>
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <span className="text-[14px] font-medium text-[var(--text-primary)]">
                {senderName(email.from)}
              </span>
              <span className="text-[13px] text-[var(--text-muted)] font-mono">
                {senderEmail(email.from)}
              </span>
            </div>
          </div>

          {email.to && (
            <div className="flex gap-4 items-baseline">
              <span className="w-12 text-[12px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">To</span>
              <span className="text-[13px] text-[var(--text-primary)] flex-1">{email.to}</span>
            </div>
          )}

          <div className="flex gap-4 items-baseline">
            <span className="w-12 text-[12px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">Date</span>
            <span className="font-mono text-[13px] text-[var(--text-primary)] flex-1">
              {formattedDate}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

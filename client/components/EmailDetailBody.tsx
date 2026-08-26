"use client";

import { CategoryMeta } from "@/lib/utils/email";
import { EmailDetailData } from "./EmailDetail";

interface EmailDetailBodyProps {
  email: EmailDetailData;
  cat: CategoryMeta;
  hasHtml: boolean;
  safeHtml: string;
}

export default function EmailDetailBody({ email, hasHtml, safeHtml }: EmailDetailBodyProps) {
  return (
    <div className="py-2">
      {hasHtml ? (
        <div
          className="email-body text-[15px] text-[var(--text-primary)] leading-[1.7] break-words max-w-none"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      ) : (
        <pre className="text-[15px] text-[var(--text-primary)] whitespace-pre-wrap font-sans leading-[1.7] m-0">
          {email.bodyText || email.snippet || "No content"}
        </pre>
      )}
    </div>
  );
}

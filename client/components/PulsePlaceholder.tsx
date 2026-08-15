import { useState, useEffect } from "react";
import { cn } from "@/lib/utils/cn";

interface PulsePlaceholderProps {
  active: boolean;
  count: number;
}

export default function PulsePlaceholder({ active, count }: PulsePlaceholderProps) {
  const [render, setRender] = useState(active);

  useEffect(() => {
    if (active) {
      setRender(true);
    } else {
      // Keep it in DOM for 500ms while it fades out
      const t = setTimeout(() => setRender(false), 500);
      return () => clearTimeout(t);
    }
  }, [active]);

  if (!render) return null;

  return (
    <div 
      className={cn(
        "flex items-center px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-inbox)] overflow-hidden",
        active 
          ? "opacity-100 animate-pulse relative" 
          : "opacity-0 absolute top-0 left-0 w-full z-10 pointer-events-none transition-opacity duration-500 ease-in-out"
      )}
    >
      <div className="flex items-center gap-3 w-[240px] shrink-0">
        <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-xs font-medium text-[var(--accent)] shrink-0">
          <span className="opacity-50 flex mb-[2px]">•</span>
        </div>
        <span className="text-sm font-medium text-[var(--text-primary)]">
          Incoming…
        </span>
      </div>
      <div className="flex-1 min-w-0 pr-4">
        <span className="text-sm text-[var(--text-secondary)] truncate block">
          {count <= 1 
            ? "Receiving new email…" 
            : `Receiving ${count} new emails…`}
        </span>
      </div>
      <div className="w-[100px] shrink-0 text-right pr-2">
        <span className="text-xs text-[var(--text-tertiary)]">Just now</span>
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils/cn";
import {
  Inbox, Briefcase, Bell, CreditCard, Car, Plane, Pizza,
  ShoppingBag, Pill, GraduationCap, Newspaper, User, Tag,
  Loader2, WifiOff
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Inbox, Briefcase, Bell, CreditCard, Car, Plane, Pizza,
  ShoppingBag, Pill, GraduationCap, Newspaper, User, Tag
};

interface EmptyEmailStateProps {
  type: "loading" | "empty" | "error";
  iconName?: string;
  folder?: string;
  /** O-H2: shown only for type="error" — failures must never read as "caught up". */
  onRetry?: () => void;
}

export default function EmptyEmailState({ type, iconName, folder, onRetry }: EmptyEmailStateProps) {
  const Icon = iconName ? (ICON_MAP[iconName] || Inbox) : Inbox;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      {type === "loading" ? (
        <span className="text-[13px] text-[var(--text-muted)]">
          Loading...
        </span>
      ) : type === "error" ? (
        <>
          <WifiOff className="w-5 h-5 text-red-400 mb-2" strokeWidth={1.5} />
          <span className="text-[13px] text-[var(--text-secondary)]">
            Couldn't load your emails.
          </span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[12px] px-3 py-1.5 rounded-md border border-[var(--border-subtle)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] transition-colors duration-100 cursor-pointer outline-none"
            >
              Try again
            </button>
          )}
        </>
      ) : (
        <>
          <Icon className="w-5 h-5 text-[var(--text-muted)] mb-2" strokeWidth={1.5} />
          <span className="text-[13px] text-[var(--text-secondary)]">You're caught up.</span>
        </>
      )}
    </div>
  );
}

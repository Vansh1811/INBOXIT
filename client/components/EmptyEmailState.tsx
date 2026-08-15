import { cn } from "@/lib/utils/cn";
import { 
  Inbox, Briefcase, Bell, CreditCard, Car, Plane, Pizza, 
  ShoppingBag, Pill, GraduationCap, Newspaper, User, Tag, 
  Loader2
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
  Inbox, Briefcase, Bell, CreditCard, Car, Plane, Pizza, 
  ShoppingBag, Pill, GraduationCap, Newspaper, User, Tag
};

interface EmptyEmailStateProps {
  type: "loading" | "empty";
  iconName?: string;
  folder?: string;
}

export default function EmptyEmailState({ type, iconName, folder }: EmptyEmailStateProps) {
  const Icon = iconName ? (ICON_MAP[iconName] || Inbox) : Inbox;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      {type === "loading" ? (
        <span className="text-[13px] text-[var(--text-muted)]">
          Loading...
        </span>
      ) : (
        <>
          <Icon className="w-5 h-5 text-[var(--text-muted)] mb-2" strokeWidth={1.5} />
          <span className="text-[13px] text-[var(--text-secondary)]">You're caught up.</span>
        </>
      )}
    </div>
  );
}

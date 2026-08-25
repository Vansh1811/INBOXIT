"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useSyncContext } from "@/lib/contexts/SyncContext";
import { cn } from "@/lib/utils/cn";
import api from "@/lib/api";
import {
  Inbox, Pin, Mail, LogOut,
  Briefcase, CreditCard, Pizza, Plane, Pill, Bell,
  Archive, Trash2
} from "lucide-react";

type NavItem = {
  slug: string;
  name: string;
  icon: React.ElementType;
};

// Slugs map 1:1 to backend folder queries:
//   inbox/pinned/unread/archive/trash → special state queries
//   jobs/finance/food/travel/health/social → canonical categories
const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "INBOX",
    items: [
      { slug: "inbox", name: "Inbox", icon: Inbox },
      { slug: "pinned", name: "Pinned", icon: Pin },
      { slug: "unread", name: "Unread", icon: Mail },
    ],
  },
  {
    title: "SMART",
    items: [
      { slug: "jobs", name: "Jobs", icon: Briefcase },
      { slug: "finance", name: "Finance", icon: CreditCard },
      { slug: "food", name: "Food", icon: Pizza },
      { slug: "travel", name: "Travel", icon: Plane },
      { slug: "health", name: "Health", icon: Pill },
      { slug: "social", name: "Social", icon: Bell },
    ],
  },
  {
    title: "LIBRARY",
    items: [
      { slug: "archive", name: "Archive", icon: Archive },
      { slug: "trash", name: "Trash", icon: Trash2 },
    ],
  },
];

interface SidebarProps { mobile?: boolean; }

export default function Sidebar({ mobile = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { syncState } = useSyncContext();

  const currentFolder = pathname.replace("/dashboard/", "").replace("/dashboard", "") || "inbox";

  if (mobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-sidebar)] border-t border-[var(--border-subtle)] flex items-center justify-around px-2 pt-2.5 pb-4">
        {NAV_SECTIONS[0].items.map((f) => {
          const isActive = currentFolder === f.slug;
          const Icon = f.icon;
          return (
            <Link
              key={f.slug}
              href={`/dashboard/${f.slug}`}
              className={cn(
                "flex flex-col items-center gap-[3px] px-2.5 py-1 rounded-md no-underline transition-colors duration-100",
                isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              )}
            >
              <Icon className="w-5 h-5" strokeWidth={1.5} />
              <span className="font-sans text-[10px] tracking-wide font-medium">
                {f.name}
              </span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside className="w-[240px] h-screen flex flex-col sticky top-0 shrink-0 bg-transparent border-r border-[var(--border-subtle)]">
      
      {/* ── LOGO ── */}
      <div className="pt-6 px-5 pb-5">
        <Link href="/dashboard/inbox" className="flex items-center gap-2 no-underline outline-none rounded-md">
          <div className="w-5 h-5 shrink-0 flex items-center justify-center text-[var(--accent)]">
            <Mail className="w-5 h-5" strokeWidth={2} />
          </div>
          <span className="text-[15px] font-medium tracking-tight text-[var(--text-primary)]">
            InboxIt
          </span>
        </Link>
      </div>

      {/* ── NAV ── */}
      <nav className="flex-1 overflow-y-auto px-4 py-4">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.title} className={cn("mb-8", idx === NAV_SECTIONS.length - 1 && "mb-4")}>
            <div className="font-sans text-[11px] font-semibold tracking-wider text-[var(--text-muted)] px-3 mb-2">
              {section.title}
            </div>

            <ul className="list-none flex flex-col gap-1 p-0 m-0">
              {section.items.map((folder) => {
                const isActive = currentFolder === folder.slug;
                const Icon = folder.icon;
                
                return (
                  <li key={folder.slug}>
                    <Link
                      href={`/dashboard/${folder.slug}`}
                      className={cn(
                        "relative group flex items-center gap-3 px-3 py-2 rounded-md no-underline transition-colors duration-100 outline-none",
                        isActive
                          ? "text-[var(--accent)] bg-[var(--hover)] font-medium"
                          : "text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text-primary)] font-normal"
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                      <span className="text-[14px] tracking-tight flex-1">
                        {folder.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── SYNC STATUS (Breathing Dot) + LOGOUT ── */}
      <div className="px-5 py-4 flex items-center gap-2 border-t border-[var(--border-subtle)]">
        <div className="relative flex items-center justify-center w-2 h-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            syncState.isSyncing ? "bg-[var(--accent)] animate-pulse" : "bg-[var(--text-muted)]"
          )} />
        </div>
        <span className="text-[12px] font-medium text-[var(--text-muted)] flex-1">
          {syncState.isSyncing ? "Syncing..." : "Connected"}
        </span>
        <button
          onClick={async () => {
            try {
              await api.post("/auth/logout");
            } finally {
              router.replace("/");
              router.refresh();
            }
          }}
          title="Log out"
          aria-label="Log out"
          className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] transition-colors duration-100 bg-transparent border-none cursor-pointer outline-none"
        >
          <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      </div>
      
    </aside>
  );
}
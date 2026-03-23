"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncContext } from "@/lib/contexts/SyncContext";
import api from "@/lib/api";
import { useToast } from "@/lib/contexts/ToastContext";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// ─── CONFIG ───────────────────────────────────────────────────────────────────

const folders = [
  { name: "Inbox",       slug: "inbox",       icon: "📬", rgb: "255,255,255"  },
  { name: "Jobs",        slug: "jobs",        icon: "💼", rgb: "59,130,246"   },
  { name: "Social",      slug: "social",      icon: "🔔", rgb: "139,92,246"  },
  { name: "Finance",     slug: "finance",     icon: "💳", rgb: "16,185,129"  },
  { name: "Cabs",        slug: "cabs",        icon: "🚕", rgb: "251,191,36"  },
  { name: "Travel",      slug: "travel",      icon: "✈️", rgb: "96,165,250"  },
  { name: "Food",        slug: "food",        icon: "🍕", rgb: "249,115,22"  },
  { name: "Shopping",    slug: "shopping",    icon: "🛍️", rgb: "236,72,153" },
  { name: "Health",      slug: "health",      icon: "💊", rgb: "52,211,153"  },
  { name: "Education",   slug: "education",   icon: "🎓", rgb: "251,113,133" },
  { name: "Newsletters", slug: "newsletters", icon: "📰", rgb: "56,189,248"  },
  { name: "Personal",    slug: "personal",    icon: "👤", rgb: "248,250,252" },
  { name: "Promotions",  slug: "promotions",  icon: "🏷️", rgb: "250,204,21" },
];


interface SidebarProps { mobile?: boolean; }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function Sidebar({ mobile = false }: SidebarProps) {
  const pathname = usePathname();
  const { syncState } = useSyncContext();
  const { addToast } = useToast();

  const currentFolder =
    pathname.replace("/dashboard/", "").replace("/dashboard", "") || "inbox";

  const syncPercent =
    syncState.total > 0 ? Math.round((syncState.progress / syncState.total) * 100) : 0;

  const handleSync = async () => {
    try { await api.post("/sync"); addToast("Sync triggered", "info"); }
    catch { addToast("Failed to trigger sync", "error"); }
  };

  const handleLoadMore = async () => {
    try { await api.post("/sync/load-more"); addToast("Loading more emails…", "info"); }
    catch { addToast("Failed to load more emails", "error"); }
  };

  // ── MOBILE ──────────────────────────────────────────────────────────────────

  if (mobile) {
    return (
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
        background: "rgba(5,5,8,0.88)",
        backdropFilter: "blur(28px)",
        WebkitBackdropFilter: "blur(28px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", justifyContent: "space-around",
        padding: "10px 8px 16px",
      }}>
        {folders.slice(0, 5).map((f) => {
          const isActive = currentFolder === f.slug;
          return (
            <Link key={f.slug} href={`/dashboard/${f.slug}`} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "4px 10px", borderRadius: 10, textDecoration: "none",
              color: isActive ? `rgb(${f.rgb})` : "rgba(255,255,255,0.28)",
              transition: "color 0.2s",
            }}>
              <span style={{ fontSize: 20 }}>{f.icon}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: "0.08em" }}>
                {f.name.toUpperCase()}
              </span>
            </Link>
          );
        })}
        <button onClick={handleSync} suppressHydrationWarning style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          padding: "4px 10px", borderRadius: 10, background: "none", border: "none", cursor: "pointer",
          color: "rgba(255,255,255,0.28)",
        }}>
          <span style={{ fontSize: 20, display: "inline-block", animation: syncState.isSyncing ? "spin-slow 0.8s linear infinite" : "none" }}>🔄</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, letterSpacing: "0.08em" }}>SYNC</span>
        </button>
      </nav>
    );
  }

  // ── DESKTOP ─────────────────────────────────────────────────────────────────

  return (
    <aside style={{
      width: 236,
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      position: "sticky",
      top: 0,
      flexShrink: 0,
      /* Glass panel */
      background: "rgba(5,5,8,0.72)",
      backdropFilter: "blur(32px)",
      WebkitBackdropFilter: "blur(32px)",
      borderRight: "1px solid rgba(255,255,255,0.07)",
      /* Subtle top aurora hint */
      backgroundImage: "radial-gradient(ellipse 180% 35% at 50% 0%, rgba(37,99,235,0.13) 0%, transparent 100%)",
    }}>

      {/* ── LOGO ── */}
      <div style={{
        padding: "22px 18px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <Link href="/dashboard/inbox" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 22px rgba(37,99,235,0.55), 0 0 44px rgba(37,99,235,0.2)",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: "-0.035em", color: "#fff" }}>
            InboxIt
          </span>
        </Link>
      </div>

      {/* ── NAV ── */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "14px 10px" }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.18)", padding: "0 10px", marginBottom: 10,
        }}>
          // smart folders
        </div>

        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
          {folders.map((folder) => {
            const isActive = currentFolder === folder.slug;
            return (
              <li key={folder.slug}>
                <Link
                  href={`/dashboard/${folder.slug}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 10px", borderRadius: 11,
                    textDecoration: "none",
                    border: `1px solid ${isActive ? `rgba(${folder.rgb},0.3)` : "transparent"}`,
                    background: isActive
                      ? `rgba(${folder.rgb},0.1)`
                      : "transparent",
                    boxShadow: isActive ? `0 0 24px rgba(${folder.rgb},0.1), inset 0 0 12px rgba(${folder.rgb},0.04)` : "none",
                    transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                    }
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>{folder.icon}</span>

                  <span style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                    flex: 1,
                    transition: "color 0.2s",
                  }}>
                    {folder.name}
                  </span>

                  {isActive && (
                    <div style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: `rgb(${folder.rgb})`,
                      boxShadow: `0 0 10px rgba(${folder.rgb},1)`,
                      animation: "glow-breath 2.5s ease infinite",
                    }} />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── SYNC ── */}
      <div style={{ padding: "10px 10px 18px", display: "flex", flexDirection: "column", gap: 8 }}>

        {/* Sync progress */}
        {syncState.isSyncing && syncState.total > 0 && (
          <div style={{
            padding: "11px 12px", borderRadius: 12,
            background: "rgba(37,99,235,0.09)",
            border: "1px solid rgba(37,99,235,0.22)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#93C5FD" }}>
                Syncing…
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.28)" }}>
                {syncState.progress}/{syncState.total}
              </span>
            </div>
            <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
              <div style={{
                height: "100%", width: `${syncPercent}%`,
                background: "linear-gradient(90deg, #2563EB, #06B6D4)",
                boxShadow: "0 0 10px rgba(37,99,235,0.8)",
                borderRadius: 3, position: "relative", overflow: "hidden",
                transition: "width 0.3s ease",
              }}>
                <div style={{
                  position: "absolute", inset: 0,
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                  animation: "shimmer-bar 1.8s linear infinite",
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Load more */}
        {syncState.hasMore && !syncState.isSyncing && (
          <button
            onClick={handleLoadMore}
            style={{
              width: "100%", padding: "9px 12px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
              color: "rgba(255,255,255,0.35)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, letterSpacing: "0.05em",
              cursor: "pointer", textAlign: "center",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.7)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.025)";
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)";
            }}
          >
            ↓ Load older emails
          </button>
        )}

        {/* Sync Now */}
        <button
          onClick={handleSync}
          disabled={syncState.isSyncing}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "11px 12px", borderRadius: 11,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: syncState.isSyncing ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)",
            fontSize: 13, fontWeight: 500, cursor: "pointer",
            backdropFilter: "blur(8px)",
            transition: "all 0.2s",
            opacity: syncState.isSyncing ? 0.5 : 1,
          }}
          onMouseEnter={e => {
            if (!syncState.isSyncing) {
              (e.currentTarget as HTMLElement).style.background = "rgba(37,99,235,0.1)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(37,99,235,0.3)";
              (e.currentTarget as HTMLElement).style.color = "#fff";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(37,99,235,0.15)";
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)";
            (e.currentTarget as HTMLElement).style.boxShadow = "none";
          }}
        >
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, animation: syncState.isSyncing ? "spin-slow 0.8s linear infinite" : "none" }}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          {syncState.isSyncing ? "Syncing…" : "Sync Now"}
        </button>

        {/* Version */}
        <div style={{ textAlign: "center", paddingTop: 2 }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, color: "rgba(255,255,255,0.1)", letterSpacing: "0.1em",
          }}>
            INBOXIT · BETA v0.1
          </span>
        </div>
      </div>
    </aside>
  );
}
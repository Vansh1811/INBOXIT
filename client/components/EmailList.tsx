"use client";

import { useState, useEffect } from "react";
import { useEmails } from "@/lib/hooks/useEmails";
import { useSocketContext } from "@/lib/contexts/SocketContext";
import { useToast } from "@/lib/contexts/ToastContext";
import SearchBar from "@/components/SearchBar";
import EmailDetail from "@/components/EmailDetail";
import api from "@/lib/api";

// ─── CATEGORY CONFIG ─────────────────────────────────────────────────────────

// ─── CATEGORY CONFIG ─────────────────────────────────────────────────────────

const CAT: Record<string, { rgb: string; label: string; icon: string }> = {
  uncategorized: { rgb: "255,255,255", label: "Inbox",      icon: "📬" },
  jobs:          { rgb: "59,130,246",  label: "Jobs",       icon: "💼" },
  social:        { rgb: "139,92,246",  label: "Social",     icon: "🔔" },
  finance:       { rgb: "16,185,129",  label: "Finance",    icon: "💳" },
  cabs:          { rgb: "251,191,36",  label: "Cabs",       icon: "🚕" },
  travel:        { rgb: "96,165,250",  label: "Travel",     icon: "✈️" },
  food:          { rgb: "249,115,22",  label: "Food",       icon: "🍕" },
  shopping:      { rgb: "236,72,153",  label: "Shopping",   icon: "🛍️" },
  health:        { rgb: "52,211,153",  label: "Health",     icon: "💊" },
  education:     { rgb: "251,113,133", label: "Education",  icon: "🎓" },
  newsletters:   { rgb: "56,189,248",  label: "Newsletters",icon: "📰" },
  personal:      { rgb: "248,250,252", label: "Personal",   icon: "👤" },
  promotions:    { rgb: "250,204,21",  label: "Promotions", icon: "🏷️" },
};

// Sidebar icons / folder param → emoji
const FOLDER_ICONS: Record<string, string> = {
  inbox:       "📬",
  jobs:        "💼",
  social:      "🔔",
  finance:     "💳",
  cabs:        "🚕",
  travel:      "✈️",
  food:        "🍕",
  shopping:    "🛍️",
  health:      "💊",
  education:   "🎓",
  newsletters: "📰",
  personal:    "👤",
  promotions:  "🏷️",
};


// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now   = new Date();
  const diff  = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diff < 1) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function senderName(from: string)    { return from.split("<")[0].replace(/"/g, "").trim(); }
function senderInitial(from: string) { return (senderName(from)[0] ?? "?").toUpperCase(); }

interface EmailListProps { folder: string; }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function EmailList({ folder }: EmailListProps) {
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery]         = useState("");
  const [offset, setOffset]                   = useState(0);
  const [isSyncingMore, setIsSyncingMore]     = useState(false);

  const limit = 50;
  const { addToast } = useToast();
  const { socket }   = useSocketContext();
  const { emails, totalCount = 0, isLoading, mutate } = useEmails(folder, offset, searchQuery);

  useEffect(() => { setOffset(0); setSelectedEmailId(null); }, [folder, searchQuery]);

  useEffect(() => {
    if (!socket) return;
    const onComplete = () => { mutate(); setIsSyncingMore(false); };
    socket.on("sync:complete", onComplete);
    return () => { socket.off("sync:complete", onComplete); };
  }, [socket, mutate]);

  const safeTotalCount = Math.max(totalCount, offset + emails.length);
  const startCount     = safeTotalCount === 0 ? 0 : offset + 1;
  const endCount       = Math.min(offset + limit, safeTotalCount);

  const handleNextPage = async () => {
    if (offset + limit >= safeTotalCount) {
      setIsSyncingMore(true);
      try {
        await api.post("/sync/load-more");
        addToast("Fetching older emails from Gmail…", "info");
      } catch {
        addToast("Failed to fetch older emails.", "error");
        setIsSyncingMore(false);
      }
    } else {
      setOffset((p) => Math.max(0, Math.min(p + limit, safeTotalCount - limit)));
    }
  };

  const handlePrevPage = () => setOffset((p) => Math.max(0, p - limit));

  const folderIcon = FOLDER_ICONS[folder] ?? "📬";
  const folderCat  = CAT[folder === "inbox" ? "uncategorized" : folder] ?? CAT.uncategorized;

  // ── DETAIL VIEW ─────────────────────────────────────────────────────────────

  if (selectedEmailId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, height: "100vh", overflow: "hidden" }}>
        {/* Back bar — glass */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "0 20px", height: 56, flexShrink: 0,
          background: "rgba(5,5,8,0.65)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <button
            onClick={() => setSelectedEmailId(null)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "rgba(255,255,255,0.38)", background: "none", border: "none",
              fontSize: 13, cursor: "pointer", padding: "6px 12px", borderRadius: 9,
              transition: "all 0.2s", fontFamily: "'Figtree', sans-serif",
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#fff"; el.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = "rgba(255,255,255,0.38)"; el.style.background = "none"; }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to {folder.charAt(0).toUpperCase() + folder.slice(1)}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <EmailDetail
            emailId={selectedEmailId}
            onClose={() => setSelectedEmailId(null)}
            onEmailUpdated={() => mutate()}
          />
        </div>
      </div>
    );
  }

  // ── LIST VIEW ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes row-in {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes glow-breath {
          0%,100% { opacity:0.5; box-shadow:0 0 6px rgba(96,165,250,0.6); }
          50%      { opacity:1;   box-shadow:0 0 12px rgba(96,165,250,1); }
        }
        @keyframes spin-slow { to { transform: rotate(360deg); } }

        .email-row {
          display: flex; align-items: center;
          padding: 0 22px;
          min-height: 54px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          cursor: pointer;
          position: relative;
          overflow: hidden;
          width: 100%;
          text-align: left;
          background: none;
          border-left: none; border-right: none; border-top: none;
          font-family: 'Figtree', sans-serif;
          transition: background 0.18s ease;
          animation: row-in 0.28s cubic-bezier(0.16,1,0.3,1) both;
        }
        .email-row.unread { background: rgba(255,255,255,0.018); }
        .email-row:hover  { background: rgba(255,255,255,0.035) !important; }

        /* Left accent bar */
        .email-row .acc-bar {
          position: absolute; left: 0; top: 15%; bottom: 15%;
          width: 2.5px; border-radius: 3px;
          opacity: 0; transform: scaleY(0.3);
          transition: opacity 0.2s, transform 0.22s cubic-bezier(0.16,1,0.3,1);
        }
        .email-row:hover .acc-bar { opacity: 1; transform: scaleY(1); }

        /* Shimmer overlay on hover */
        .email-row::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.018), transparent);
          transform: translateX(-200%);
          pointer-events: none;
        }
        .email-row:hover::after {
          transform: translateX(200%);
          transition: transform 0.55s ease;
        }

        .star-btn {
          background: none; border: none; cursor: pointer; padding: 4px;
          color: rgba(255,255,255,0.18); border-radius: 5px;
          transition: color 0.2s, transform 0.15s;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .star-btn:hover  { color: rgba(250,204,21,0.7); transform: scale(1.25); }
        .star-btn.active { color: #FACC15; }

        .nav-btn {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px; color: rgba(255,255,255,0.4);
          cursor: pointer;
          transition: all 0.18s;
        }
        .nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.13); }
        .nav-btn:disabled { opacity: 0.22; cursor: not-allowed; }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", minWidth: 0 }}>

        {/* ── HEADER — glass panel ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 22px", height: 60, flexShrink: 0, gap: 16,
          background: "rgba(5,5,8,0.65)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          /* Faint category glow on the right edge */
          boxShadow: `inset -1px 0 0 rgba(${folderCat.rgb},0.0)`,
        }}>
          {/* Folder title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9, flexShrink: 0,
              background: `rgba(${folderCat.rgb},0.12)`,
              border: `1px solid rgba(${folderCat.rgb},0.25)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15,
              boxShadow: `0 0 14px rgba(${folderCat.rgb},0.18)`,
            }}>
              {folderIcon}
            </div>

            <span style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: 13, fontWeight: 800,
              letterSpacing: "-0.035em", color: "#fff",
              textTransform: "capitalize",
            }}>
              {folder}
            </span>

            {safeTotalCount > 0 && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10, color: "rgba(255,255,255,0.28)",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "2px 8px", borderRadius: 5,
              }}>
                {safeTotalCount}
              </span>
            )}
          </div>

          {/* Search */}
          <div style={{ flex: 1, maxWidth: 380 }}>
            <SearchBar onSearch={setSearchQuery} />
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.22)" }}>
              {isSyncingMore ? "fetching…" : `${startCount}–${endCount} of ${safeTotalCount}`}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="nav-btn" onClick={handlePrevPage} disabled={offset === 0 || isLoading || isSyncingMore}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button className="nav-btn" onClick={handleNextPage} disabled={isLoading || isSyncingMore}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── COLUMN LABELS ── */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "0 22px", height: 28, flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.03)",
          background: "rgba(255,255,255,0.008)",
        }}>
          <div style={{ width: 50, flexShrink: 0 }} />
          <div style={{ width: 188, flexShrink: 0, ...colLabelStyle }}>Sender</div>
          <div style={{ flex: 1, ...colLabelStyle }}>Subject</div>
          <div style={{ width: 138, flexShrink: 0, textAlign: "right", ...colLabelStyle }}>Time</div>
        </div>

        {/* ── ROWS ── */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isLoading && emails.length === 0 ? (
            <EmptyState type="loading" />
          ) : emails.length === 0 ? (
            <EmptyState type="empty" icon={folderIcon} folder={folder} />
          ) : (
            emails.map((email, idx) => {
              const cat     = CAT[email.category] ?? CAT.uncategorized;
              const isInbox = folder === "inbox";
              const delay   = Math.min(idx * 0.022, 0.45);

              return (
                <button
                  key={email._id}
                  className={`email-row${!email.isRead ? " unread" : ""}`}
                  onClick={() => setSelectedEmailId(email._id)}
                  style={{ animationDelay: `${delay}s` }}
                >
                  {/* Category accent bar */}
                  <div className="acc-bar" style={{
                    background: `rgb(${cat.rgb})`,
                    boxShadow: `0 0 8px rgba(${cat.rgb},0.7)`,
                  }} />

                  {/* Controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, width: 50, flexShrink: 0 }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                      border: "1px solid rgba(255,255,255,0.14)", background: "none", cursor: "pointer",
                    }} />
                    <button
                      className={`star-btn${email.isStarred ? " active" : ""}`}
                      onClick={e => e.stopPropagation()}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={email.isStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  </div>

                  {/* Sender */}
                  <div style={{ width: 188, flexShrink: 0, display: "flex", alignItems: "center", gap: 9, paddingRight: 16 }}>
                    {/* Unread glow dot */}
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: !email.isRead ? "#60A5FA" : "transparent",
                      boxShadow: !email.isRead ? "0 0 8px rgba(96,165,250,0.9)" : "none",
                      animation: !email.isRead ? "glow-breath 2.5s ease infinite" : "none",
                    }} />

                    {/* Avatar */}
                    <div style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                      background: `rgba(${cat.rgb},0.14)`,
                      border: `1px solid rgba(${cat.rgb},0.3)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800,
                      color: `rgb(${cat.rgb})`,
                      fontFamily: "'Unbounded', sans-serif",
                      boxShadow: `0 0 10px rgba(${cat.rgb},0.1)`,
                    }}>
                      {senderInitial(email.from)}
                    </div>

                    {/* Name */}
                    <span style={{
                      fontSize: 13, flex: 1,
                      fontWeight: !email.isRead ? 600 : 400,
                      color: !email.isRead ? "#fff" : "rgba(255,255,255,0.5)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {senderName(email.from)}
                    </span>
                  </div>

                  {/* Subject + snippet */}
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
                    <span style={{
                      fontSize: 13, flexShrink: 0, maxWidth: "42%",
                      fontWeight: !email.isRead ? 600 : 400,
                      color: !email.isRead ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.48)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {email.subject || "(no subject)"}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 13, flexShrink: 0 }}>—</span>
                    <span style={{
                      fontSize: 12, color: "rgba(255,255,255,0.24)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {email.snippet}
                    </span>
                  </div>

                  {/* Right meta */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, paddingLeft: 14, width: 138, justifyContent: "flex-end" }}>
                    {email.category && email.category !== "uncategorized" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9, letterSpacing: "0.03em",
                        color: `rgb(${cat.rgb})`,
                        background: `rgba(${cat.rgb},0.1)`,
                        border: `1px solid rgba(${cat.rgb},0.22)`,
                        padding: "2px 7px", borderRadius: 5,
                        whiteSpace: "nowrap",
                        boxShadow: `0 0 8px rgba(${cat.rgb},0.08)`,
                      }}>
                        {cat.label}
                      </span>
                    )}
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                      color: !email.isRead ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)",
                      fontWeight: !email.isRead ? 500 : 400, whiteSpace: "nowrap",
                    }}>
                      {formatTime(email.receivedAt)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const colLabelStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 9, letterSpacing: "0.1em",
  color: "rgba(255,255,255,0.14)", textTransform: "uppercase",
};

function EmptyState({ type, icon, folder }: { type: "loading" | "empty"; icon?: string; folder?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "80px 0", gap: 14 }}>
      {type === "loading" ? (
        <>
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            border: "2px solid rgba(37,99,235,0.2)",
            borderTop: "2px solid #2563EB",
            animation: "spin-slow 0.8s linear infinite",
          }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.08em" }}>
            Loading emails…
          </span>
        </>
      ) : (
        <>
          <div style={{
            width: 58, height: 58, borderRadius: 16, fontSize: 26,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {icon}
          </div>
          <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 13 }}>No emails in {folder}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.14)" }}>
            try syncing from the sidebar
          </span>
        </>
      )}
    </div>
  );
}
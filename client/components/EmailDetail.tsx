"use client";

import { useState, useEffect, useMemo } from "react";
import api from "@/lib/api";
import DOMPurify from "dompurify";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface EmailDetailData {
  _id: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  category: string;
}

interface EmailDetailProps {
  emailId: string;
  onClose: () => void;
  onEmailUpdated: () => void;
}

// ─── CATEGORY CONFIG ─────────────────────────────────────────────────────────

const CAT: Record<string, { rgb: string; label: string; icon: string }> = {
  uncategorized: { rgb: "255,255,255", label: "Inbox",   icon: "📬" },
  jobs:          { rgb: "59,130,246",  label: "Jobs",    icon: "💼" },
  finance:       { rgb: "16,185,129",  label: "Finance", icon: "💳" },
  social:        { rgb: "139,92,246",  label: "Social",  icon: "🔔" },
  food:          { rgb: "249,115,22",  label: "Food",    icon: "🍕" },
  cabs:          { rgb: "251,191,36",  label: "Cabs",    icon: "🚕" },
  health:        { rgb: "236,72,153",  label: "Health",  icon: "💊" },
  todo:          { rgb: "6,182,212",   label: "Todo",    icon: "✅" },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function senderName(from: string)  { return from.split("<")[0].replace(/"/g, "").trim(); }
function senderEmail(from: string) { return from.match(/<(.+)>/)?.[1] ?? from; }
function senderInitial(from: string) { return (senderName(from)[0] ?? "?").toUpperCase(); }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function EmailDetail({ emailId, onClose, onEmailUpdated }: EmailDetailProps) {
  const [email, setEmail]     = useState<EmailDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const hasHtml = useMemo(() => {
    if (!email?.bodyHtml) return false;
    return stripHtml(email.bodyHtml).length >= 20;
  }, [email?.bodyHtml]);

  const safeHtml = useMemo(() => {
    if (!email?.bodyHtml) return "";
    return DOMPurify.sanitize(email.bodyHtml, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "form", "object"],
      ADD_ATTR: ["target"],
    });
  }, [email?.bodyHtml]);

  useEffect(() => {
    setLoading(true); setError(null);
    api.get(`/api/emails/${emailId}`)
      .then((res) => {
        setEmail(res.data);
        if (!res.data.isRead) {
          api.patch(`/api/emails/${emailId}`, { isRead: true }).then(() => onEmailUpdated());
        }
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load email"))
      .finally(() => setLoading(false));
  }, [emailId]);

  const toggle = async (field: "isStarred" | "isRead") => {
    if (!email) return;
    try {
      await api.patch(`/api/emails/${email._id}`, { [field]: !email[field] });
      setEmail((p) => p ? { ...p, [field]: !p[field] } : p);
      onEmailUpdated();
    } catch {}
  };

  const handleArchive = async () => {
    if (!email) return;
    try { await api.post(`/api/emails/${email._id}/archive`); onEmailUpdated(); onClose(); } catch {}
  };

  const handleDelete = async () => {
    if (!email) return;
    try { await api.delete(`/api/emails/${email._id}`); onEmailUpdated(); onClose(); } catch {}
  };

  const formattedDate = email
    ? new Date(email.receivedAt).toLocaleString("en-IN", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    : "";

  const cat = CAT[email?.category ?? "uncategorized"] ?? CAT.uncategorized;

  // ── LOADING ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14 }}>
      <style>{`@keyframes spin-slow{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 30, height: 30, borderRadius: "50%", border: "2px solid rgba(37,99,235,0.2)", borderTop: "2px solid #2563EB", animation: "spin-slow 0.8s linear infinite" }} />
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.08em" }}>Loading email…</span>
    </div>
  );

  if (error || !email) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
      <span style={{ fontSize: 32 }}>⚠️</span>
      <p style={{ color: "rgba(239,68,68,0.8)", fontSize: 13 }}>{error || "Email not found"}</p>
      <button onClick={onClose} style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>← go back</button>
    </div>
  );

  // ── MAIN ─────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes detail-in { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin-slow  { to { transform: rotate(360deg); } }

        .tb-btn {
          display:flex; align-items:center; justify-content:center;
          width:34px; height:34px; border-radius:9px; border:none;
          background:transparent; color:rgba(255,255,255,0.32); cursor:pointer;
          transition:all 0.18s; flex-shrink:0;
        }
        .tb-btn:hover         { background:rgba(255,255,255,0.08); color:rgba(255,255,255,0.9); }
        .tb-btn.danger:hover  { background:rgba(239,68,68,0.12); color:#F87171; }
        .tb-btn.starred       { color:#FACC15; }

        .email-body a  { color:#60A5FA !important; }
        .email-body a:hover { text-decoration: underline; }
        .email-body table { max-width:100%; }
        .email-body img   { max-width:100%; border-radius:8px; margin-top:8px; }
        .email-body p  { margin-bottom:14px; }
        .email-body h1,.email-body h2,.email-body h3 { color:rgba(255,255,255,0.85); margin-bottom:10px; margin-top:16px; }
      `}</style>

      <div style={{ display:"flex", flexDirection:"column", height:"100%", animation:"detail-in 0.3s cubic-bezier(0.16,1,0.3,1) both" }}>

        {/* ── TOOLBAR ── */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"0 20px", height:56, flexShrink:0,
          background:"rgba(5,5,8,0.65)",
          backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
          borderBottom:`1px solid rgba(${cat.rgb},0.12)`,
          boxShadow:`inset 0 -1px 0 rgba(${cat.rgb},0.08)`,
        }}>
          {/* Back */}
          <button
            onClick={onClose}
            style={{ display:"flex", alignItems:"center", gap:7, color:"rgba(255,255,255,0.35)", background:"none", border:"none", fontSize:13, cursor:"pointer", padding:"6px 12px", borderRadius:9, transition:"all 0.2s", fontFamily:"'Figtree',sans-serif" }}
            onMouseEnter={e=>{ const el=e.currentTarget as HTMLElement; el.style.color="#fff"; el.style.background="rgba(255,255,255,0.06)"; }}
            onMouseLeave={e=>{ const el=e.currentTarget as HTMLElement; el.style.color="rgba(255,255,255,0.35)"; el.style.background="none"; }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back
          </button>

          {/* Actions */}
          <div style={{ display:"flex", alignItems:"center", gap:2 }}>
            <button className="tb-btn" onClick={() => toggle("isRead")} title={email.isRead ? "Mark unread" : "Mark read"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill={email.isRead ? "none" : "rgba(255,255,255,0.7)"} stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
              </svg>
            </button>

            <button className={`tb-btn${email.isStarred ? " starred" : ""}`} onClick={() => toggle("isStarred")} title={email.isStarred ? "Unstar" : "Star"}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill={email.isStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>

            <div style={{ width:1, height:20, background:"rgba(255,255,255,0.07)", margin:"0 4px" }}/>

            <button className="tb-btn" onClick={handleArchive} title="Archive">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="5" rx="1"/>
                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
                <path d="M10 12h4"/>
              </svg>
            </button>

            <button className="tb-btn danger" onClick={handleDelete} title="Delete">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── SCROLL AREA ── */}
        <div style={{ flex:1, overflowY:"auto" }}>
          <div style={{ maxWidth:740, margin:"0 auto", padding:"44px 32px 100px" }}>

            {/* Subject */}
            <h1 style={{
              fontFamily:"'Figtree',sans-serif",
              fontSize:"clamp(19px,2.5vw,26px)",
              fontWeight:600, color:"#fff",
              letterSpacing:"-0.022em", lineHeight:1.3,
              marginBottom:28,
            }}>
              {email.subject || "(no subject)"}
            </h1>

            {/* Sender card — glass */}
            <div style={{
              display:"flex", alignItems:"flex-start", gap:14,
              padding:"16px 20px", borderRadius:16, marginBottom:32,
              background:"rgba(255,255,255,0.025)",
              border:`1px solid rgba(${cat.rgb},0.18)`,
              backdropFilter:"blur(16px)",
              boxShadow:`0 0 30px rgba(${cat.rgb},0.06), inset 0 1px 0 rgba(255,255,255,0.04)`,
            }}>
              {/* Avatar */}
              <div style={{
                width:44, height:44, borderRadius:12, flexShrink:0,
                background:`rgba(${cat.rgb},0.14)`,
                border:`1.5px solid rgba(${cat.rgb},0.32)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:17, fontWeight:900, color:`rgb(${cat.rgb})`,
                fontFamily:"'Unbounded',sans-serif",
                boxShadow:`0 0 18px rgba(${cat.rgb},0.2)`,
              }}>
                {senderInitial(email.from)}
              </div>

              {/* Meta */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" }}>
                    <span style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.9)" }}>
                      {senderName(email.from)}
                    </span>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"'JetBrains Mono',monospace" }}>
                      {senderEmail(email.from)}
                    </span>
                    {/* Category badge */}
                    <span style={{
                      fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                      color:`rgb(${cat.rgb})`,
                      background:`rgba(${cat.rgb},0.12)`,
                      border:`1px solid rgba(${cat.rgb},0.28)`,
                      padding:"2px 8px", borderRadius:5,
                      boxShadow:`0 0 10px rgba(${cat.rgb},0.12)`,
                    }}>
                      {cat.icon} {cat.label}
                    </span>
                  </div>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"rgba(255,255,255,0.22)", flexShrink:0 }}>
                    {formattedDate}
                  </span>
                </div>
                {email.to && (
                  <p style={{ fontSize:12, color:"rgba(255,255,255,0.22)", marginTop:5 }}>to {email.to}</p>
                )}
              </div>
            </div>

            {/* ── BODY CARD ── */}
            <div style={{
              borderRadius:16, overflow:"hidden",
              background:"rgba(255,255,255,0.02)",
              border:"1px solid rgba(255,255,255,0.06)",
              backdropFilter:"blur(12px)",
              /* Top accent line in category color */
              borderTop:`2.5px solid rgba(${cat.rgb},0.35)`,
              boxShadow:`0 0 40px rgba(${cat.rgb},0.04), inset 0 1px 0 rgba(255,255,255,0.03)`,
            }}>
              {/* Category glow strip at top of body */}
              <div style={{
                height:1,
                background:`linear-gradient(90deg, transparent, rgba(${cat.rgb},0.25), transparent)`,
                marginBottom:0,
              }}/>

              <div style={{ padding:"28px 30px 34px" }}>
                {hasHtml ? (
                  <div
                    className="email-body"
                    style={{ fontSize:14, color:"rgba(255,255,255,0.7)", lineHeight:1.82, wordBreak:"break-word" }}
                    dangerouslySetInnerHTML={{ __html: safeHtml }}
                  />
                ) : (
                  <pre style={{ fontSize:14, color:"rgba(255,255,255,0.65)", whiteSpace:"pre-wrap", fontFamily:"'Figtree',sans-serif", lineHeight:1.82, margin:0 }}>
                    {email.bodyText || email.snippet || "No content"}
                  </pre>
                )}
              </div>
            </div>

            {/* Bottom action strip */}
            <div style={{ display:"flex", gap:10, marginTop:24 }}>
              <button
                onClick={handleArchive}
                style={{
                  display:"flex", alignItems:"center", gap:8,
                  padding:"10px 20px", borderRadius:10,
                  background:"rgba(255,255,255,0.04)",
                  border:"1px solid rgba(255,255,255,0.08)",
                  color:"rgba(255,255,255,0.45)", fontSize:13,
                  cursor:"pointer", transition:"all 0.2s",
                  fontFamily:"'Figtree',sans-serif",
                }}
                onMouseEnter={e=>{ const el=e.currentTarget as HTMLElement; el.style.background="rgba(255,255,255,0.07)"; el.style.color="#fff"; }}
                onMouseLeave={e=>{ const el=e.currentTarget as HTMLElement; el.style.background="rgba(255,255,255,0.04)"; el.style.color="rgba(255,255,255,0.45)"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="5" rx="1"/>
                  <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
                  <path d="M10 12h4"/>
                </svg>
                Archive
              </button>

              <button
                onClick={handleDelete}
                style={{
                  display:"flex", alignItems:"center", gap:8,
                  padding:"10px 20px", borderRadius:10,
                  background:"rgba(239,68,68,0.06)",
                  border:"1px solid rgba(239,68,68,0.15)",
                  color:"rgba(239,68,68,0.6)", fontSize:13,
                  cursor:"pointer", transition:"all 0.2s",
                  fontFamily:"'Figtree',sans-serif",
                }}
                onMouseEnter={e=>{ const el=e.currentTarget as HTMLElement; el.style.background="rgba(239,68,68,0.12)"; el.style.color="#F87171"; el.style.borderColor="rgba(239,68,68,0.3)"; }}
                onMouseLeave={e=>{ const el=e.currentTarget as HTMLElement; el.style.background="rgba(239,68,68,0.06)"; el.style.color="rgba(239,68,68,0.6)"; el.style.borderColor="rgba(239,68,68,0.15)"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
                Delete
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
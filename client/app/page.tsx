"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { name: "Jobs & Internships", short: "Jobs",    icon: "💼", color: "#3B82F6", rgba: "59,130,246",  count: 24 },
  { name: "Finance & Bills",    short: "Finance", icon: "💳", color: "#10B981", rgba: "16,185,129",  count: 31 },
  { name: "Food & Orders",      short: "Food",    icon: "🍕", color: "#F97316", rgba: "249,115,22",  count: 12 },
  { name: "Travel & Cabs",      short: "Travel",  icon: "🚕", color: "#FBBF24", rgba: "251,191,36",  count: 8  },
  { name: "Health & Meds",      short: "Health",  icon: "💊", color: "#EC4899", rgba: "236,72,153",  count: 5  },
  { name: "Social",             short: "Social",  icon: "🔔", color: "#8B5CF6", rgba: "139,92,246",  count: 47 },
];

const EMAILS = [
  { from: "Swiggy",    subject: "Your order is on the way! 🛵",        time: "2m ago",  cat: "Food",    color: "#F97316", rgba: "249,115,22"  },
  { from: "Naukri",    subject: "3 new jobs match your profile",        time: "1h ago",  cat: "Jobs",    color: "#3B82F6", rgba: "59,130,246"  },
  { from: "Razorpay",  subject: "Payment received ₹4,999 ✓",           time: "2h ago",  cat: "Finance", color: "#10B981", rgba: "16,185,129"  },
  { from: "Rapido",    subject: "Your ride receipt — Sec 62 to CP",     time: "3h ago",  cat: "Travel",  color: "#FBBF24", rgba: "251,191,36"  },
  { from: "PhonePe",   subject: "UPI transfer of ₹299 successful",      time: "4h ago",  cat: "Finance", color: "#10B981", rgba: "16,185,129"  },
  { from: "LinkedIn",  subject: "You appeared in 42 searches this week","time": "5h ago", cat: "Social",  color: "#8B5CF6", rgba: "139,92,246"  },
];

const TICKER_ITEMS = [
  "Gmail Smart Sort", "Built for India 🇮🇳", "Real-time Sync ⚡",
  "Zero Spam", "AI Categorization 🤖", "Jobs · Finance · Food · Travel",
   "For Professionals",
];

const FEATURES = [
  { icon: "🎯", title: "Opinionated sorting",    color: "#3B82F6", rgba: "59,130,246",  desc: "Gmail's tabs are a mess. InboxIt creates categories that match your actual life — not Google's defaults." },
  { icon: "⚡", title: "Real-time sync",          color: "#06B6D4", rgba: "6,182,212",   desc: "WebSockets keep your inbox live. New email? It appears instantly — no refresh, no lag, ever." },
  { icon: "🔒", title: "OAuth only, always",      color: "#8B5CF6", rgba: "139,92,246",  desc: "We never store your password. Google OAuth only. Revoke access anytime from your Google account." },
  { icon: "🇮🇳", title: "Built for India",        color: "#10B981", rgba: "16,185,129",  desc: "Swiggy. Zepto. Naukri. Razorpay. We know every app flooding your inbox — so we sorted for them." },
  //{ icon: "🤖", title: "AI classification",       color: "#F97316", rgba: "249,115,22",  desc: "Every email is read by our classifier. Context-aware, not keyword-matching. It actually understands." },
  { icon: "⚙️", title: "Smart folders",           color: "#EC4899", rgba: "236,72,153",  desc: "Browse Jobs, Finance, Food, Health — all from one clean sidebar. Your inbox, finally navigable." },
];

// ─── ANIMATED COUNTER ────────────────────────────────────────────────────────

function useCounter(end: number, duration = 2400, delay = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => {
      let start = 0;
      const step = end / (duration / 16);
      const interval = setInterval(() => {
        start = Math.min(start + step, end);
        setCount(Math.floor(start));
        if (start >= end) clearInterval(interval);
      }, 16);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [end, duration, delay]);
  return count;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [mouse, setMouse]   = useState({ x: -999, y: -999 });
  const [active, setActive] = useState(0); // active sidebar category

  const emails  = useCounter(2400, 900);
  const users   = useCounter( 20, 1000);
  const minutes = useCounter(94,1800, 1100);

  useEffect(() => {
    const onMove = (e: { clientX: any; clientY: any; }) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Rotate active category every 2s for demo feel
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % CATEGORIES.length), 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="page-root">
      {/* ── FONTS ── */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;700;900&family=Figtree:ital,wght@0,300;0,400;0,500;0,600;1,300&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      {/* ── ALL KEYFRAME ANIMATIONS ── */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .page-root {
          font-family: 'Figtree', sans-serif;
          background: #050508;
          color: #fff;
          min-height: 100vh;
          overflow-x: hidden;
          position: relative;
          cursor: none;
        }

        /* Custom cursor */
        .cursor-dot {
          pointer-events: none;
          position: fixed;
          z-index: 9999;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #60A5FA;
          transform: translate(-50%,-50%);
          transition: left 0.05s, top 0.05s;
          mix-blend-mode: screen;
        }
        .cursor-ring {
          pointer-events: none;
          position: fixed;
          z-index: 9998;
          width: 500px; height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%);
          transform: translate(-50%,-50%);
          transition: left 0.15s ease, top 0.15s ease;
        }

        /* Aurora blobs */
        @keyframes aurora1 {
          0%,100% { transform: translate(0%,0%) scale(1); }
          33%      { transform: translate(5%,-12%) scale(1.15); }
          66%      { transform: translate(-6%,6%) scale(0.9); }
        }
        @keyframes aurora2 {
          0%,100% { transform: translate(0%,0%) scale(1); }
          33%      { transform: translate(-10%,6%) scale(1.1); }
          66%      { transform: translate(6%,-10%) scale(1.05); }
        }
        @keyframes aurora3 {
          0%,100% { transform: translate(0%,0%) scale(1); }
          50%      { transform: translate(8%,8%) scale(1.2); }
        }

        /* Entrance animations */
        @keyframes slideUp {
          from { transform: translateY(50px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0.92) translateY(20px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }

        /* Ongoing animations */
        @keyframes float {
          0%,100% { transform: rotateX(3deg) translateY(0px); }
          50%      { transform: rotateX(3deg) translateY(-10px); }
        }
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes shimmer {
          0%   { transform: translateX(-200%); }
          100% { transform: translateX(300%); }
        }
        @keyframes dotPulse {
          0%,100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.6); opacity: 0.5; }
        }
        @keyframes glowPulse {
          0%,100% { opacity: 0.5; }
          50%      { opacity: 1; }
        }
        @keyframes borderGlow {
          0%,100% { box-shadow: 0 0 30px rgba(37,99,235,0.15); border-color: rgba(255,255,255,0.07); }
          50%      { box-shadow: 0 0 60px rgba(6,182,212,0.25);  border-color: rgba(6,182,212,0.25);  }
        }
        @keyframes scanline {
          0%   { transform: translateY(-8px); opacity: 0.05; }
          50%  { opacity: 0.1; }
          100% { transform: translateY(100vh); opacity: 0.05; }
        }
        @keyframes countUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Staggered entrance helpers */
        .a1  { animation: slideUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
        .a2  { animation: slideUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.25s both; }
        .a3  { animation: slideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.4s both; }
        .a4  { animation: slideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.6s both; }
        .a5  { animation: slideUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.8s both; }
        .a6  { animation: scaleIn 1s cubic-bezier(0.16,1,0.3,1) 1s both; }
        .nav { animation: fadeIn 0.5s ease 0.05s both; }

        /* Feature card hover */
        .feat-card {
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 20px;
          padding: 28px;
          background: rgba(255,255,255,0.02);
          backdrop-filter: blur(10px);
          transition: transform 0.3s cubic-bezier(0.16,1,0.3,1), border-color 0.3s, background 0.3s, box-shadow 0.3s;
        }
        .feat-card:hover {
          transform: translateY(-6px);
        }

        /* CTA button hover */
        .cta-white {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 17px 36px;
          border-radius: 100px;
          background: #fff;
          color: #050508;
          font-weight: 700;
          font-size: 15px;
          text-decoration: none;
          position: relative;
          overflow: hidden;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 24px 60px rgba(0,0,0,0.5);
          transition: transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s;
        }
        .cta-white::after {
          content: '';
          position: absolute; top: 0; left: 0;
          width: 50%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
          animation: shimmer 3.5s infinite 1.5s;
        }
        .cta-white:hover {
          transform: scale(1.04) translateY(-2px);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.2), 0 36px 80px rgba(0,0,0,0.6);
        }
        .cta-blue {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 17px 40px;
          border-radius: 100px;
          background: linear-gradient(135deg, #2563EB 0%, #06B6D4 100%);
          color: #fff;
          font-weight: 700;
          font-size: 15px;
          text-decoration: none;
          position: relative;
          overflow: hidden;
          box-shadow: 0 0 50px rgba(37,99,235,0.4);
          transition: transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s;
        }
        .cta-blue::after {
          content: '';
          position: absolute; top: 0; left: 0;
          width: 50%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
          animation: shimmer 3.5s infinite 2s;
        }
        .cta-blue:hover {
          transform: scale(1.05) translateY(-2px);
          box-shadow: 0 0 80px rgba(37,99,235,0.6);
        }

        /* Email row hover */
        .email-row {
          transition: background 0.2s;
          cursor: pointer;
        }
        .email-row:hover {
          background: rgba(255,255,255,0.025) !important;
        }

        /* Sidebar item */
        .sidebar-item {
          transition: background 0.2s, opacity 0.2s;
        }

        /* Responsive grid */
        @media (max-width: 768px) {
          .feat-grid { grid-template-columns: 1fr !important; }
          .stats-grid { grid-template-columns: 1fr !important; }
          .hero-text { font-size: 52px !important; }
        }
      `}</style>

      {/* ── CUSTOM CURSOR ── */}
      <div className="cursor-dot" style={{ left: mouse.x, top: mouse.y }} />
      <div className="cursor-ring" style={{ left: mouse.x, top: mouse.y }} />

      {/* ── AURORA BACKGROUND ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{
          position: "absolute", width: "75vw", height: "75vh", top: "-25%", left: "-15%",
          background: "radial-gradient(ellipse, rgba(37,99,235,0.28) 0%, transparent 70%)",
          filter: "blur(70px)", animation: "aurora1 14s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", width: "60vw", height: "60vh", bottom: "-15%", right: "-10%",
          background: "radial-gradient(ellipse, rgba(139,92,246,0.22) 0%, transparent 70%)",
          filter: "blur(80px)", animation: "aurora2 18s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", width: "45vw", height: "45vh", top: "25%", right: "15%",
          background: "radial-gradient(ellipse, rgba(6,182,212,0.14) 0%, transparent 70%)",
          filter: "blur(60px)", animation: "aurora3 22s ease-in-out infinite",
        }} />

        {/* Dot grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 0%, black 40%, transparent 100%)",
        }} />

        {/* Scanline */}
        <div style={{
          position: "absolute", left: 0, right: 0, height: 2,
          background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.15), transparent)",
          animation: "scanline 8s linear infinite",
        }} />

        {/* Grain */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.35, mixBlendMode: "overlay" }}>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" opacity="0.4" />
        </svg>
      </div>

      {/* ──────────────────────────── NAVBAR ──────────────────────────── */}
      <nav className="nav" style={{
        position: "relative", zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 48px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        backdropFilter: "blur(24px)",
        background: "rgba(5,5,8,0.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11,
            background: "linear-gradient(135deg, #2563EB, #06B6D4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 24px rgba(37,99,235,0.5)",
          }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: "-0.03em" }}>
            InboxIt
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", animation: "dotPulse 2s ease infinite" }} />
          · v0.1.0
        </div>
      </nav>

      {/* ──────────────────────────── HERO ──────────────────────────── */}
      <main style={{ position: "relative", zIndex: 10, padding: "0 48px", maxWidth: 1240, margin: "0 auto" }}>
        <div style={{ paddingTop: 88, paddingBottom: 0 }}>

          {/* Badge */}
          <div className="a1" style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            padding: "8px 18px", borderRadius: 100,
            border: "1px solid rgba(37,99,235,0.35)",
            background: "rgba(37,99,235,0.1)",
            backdropFilter: "blur(12px)",
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            color: "#93C5FD", marginBottom: 44,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", display: "inline-block", animation: "dotPulse 2s ease infinite" }} />
              FOR ALL PROFESSIONALS
          </div>

          {/* Headline */}
          <h1 className="a2 hero-text" style={{
            fontFamily: "'Unbounded', sans-serif",
            fontSize: "clamp(52px, 8.5vw, 104px)",
            fontWeight: 900, lineHeight: 1.0,
            letterSpacing: "-0.045em", marginBottom: 28,
          }}>
            <span style={{ display: "block", color: "white" }}>Your inbox,</span>
            <span style={{ display: "block", background: "linear-gradient(125deg, #60A5FA 0%, #06B6D4 40%, #A78BFA 80%, #F472B6 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              actually
            </span>
            <span style={{ display: "block", color: "white" }}>smart.</span>
          </h1>

          <p
            className="a3"
            style={{
              fontSize: 19,
              color: "rgba(255,255,255,0.45)",
              maxWidth: 500,
              lineHeight: 1.75,
              fontWeight: 300,
              marginBottom: 52,
            }}
          >
            Not another tab. An AI that reads your Gmail and sorts every email by what it{" "}
            <em style={{ color: "rgba(255,255,255,0.7)", fontStyle: "italic" }}>actually is</em>
            {" "}— jobs, finance, food, travel & more.
          </p>


          {/* CTA row */}
          <div className="a4" style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginBottom: 72 }}>
            <Link href="http://localhost:5000/auth/google" className="cta-white">
              <GoogleLogo />
              Continue with Google
            </Link>
            <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
              ·_· 60s setup
            </span>
          </div>

          {/* STATS BAR */}
          <div className="a5" style={{
            display: "grid", gridTemplateColumns: "repeat(3,1fr)",
            gap: 1, background: "rgba(255,255,255,0.05)",
            borderRadius: 18, overflow: "hidden", marginBottom: 88, maxWidth: 620,
          }}>
            {[
              { value: emails.toLocaleString(), suffix: "+", label: "Emails organized" },
              { value: users.toLocaleString(),  suffix: "",  label: "Students using it" },
              { value: minutes,                  suffix: "m", label: "Avg. time saved/week" },
            ].map(({ value, suffix, label }, i) => (
              <div key={label} style={{
                padding: "24px 26px", background: "rgba(5,5,8,0.85)", backdropFilter: "blur(12px)",
                animation: `countUp 0.5s ease ${0.9 + i * 0.1}s both`,
              }}>
                <div style={{
                  fontFamily: "'Unbounded', sans-serif", fontSize: 30, fontWeight: 800,
                  background: "linear-gradient(135deg, #fff 60%, rgba(255,255,255,0.45))",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                  letterSpacing: "-0.04em",
                }}>
                  {value}{suffix}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ──── APP PREVIEW ──── */}
        <div className="a6" style={{ position: "relative", perspective: "1400px" }}>
          {/* Ambient glow under app */}
          <div style={{
            position: "absolute", bottom: -60, left: "8%", right: "8%", height: 120,
            background: "linear-gradient(90deg, rgba(37,99,235,0.35), rgba(139,92,246,0.35), rgba(6,182,212,0.25))",
            filter: "blur(50px)", animation: "glowPulse 5s ease infinite",
          }} />

          {/* App window */}
          <div style={{
            borderRadius: "20px 20px 0 0",
            border: "1px solid rgba(255,255,255,0.09)", borderBottom: "none",
            background: "rgba(7,7,12,0.92)", backdropFilter: "blur(40px)",
            overflow: "hidden",
            transform: "rotateX(3.5deg)", transformOrigin: "bottom center",
            boxShadow: "0 -24px 80px rgba(37,99,235,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
            animation: "float 7s ease-in-out infinite",
          }}>
            {/* Window chrome */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 22px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(255,255,255,0.015)",
            }}>
              <div style={{ display: "flex", gap: 8 }}>
                {["#FF5F57","#FFBD2E","#28C840"].map(c => (
                  <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, opacity: 0.75 }} />
                ))}
              </div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)",
                padding: "4px 14px", borderRadius: 7,
              }}>
                app.inboxit.in
              </div>
              <div style={{ width: 68 }} />
            </div>

            {/* App layout */}
            <div style={{ display: "flex", height: 420 }}>

              {/* ── SIDEBAR ── */}
              <div style={{
                width: 228, borderRight: "1px solid rgba(255,255,255,0.05)",
                padding: "18px 10px", flexShrink: 0, overflowY: "hidden",
              }}>
                {/* Logo row in sidebar */}
                <div style={{ padding: "6px 10px", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 7,
                    background: "linear-gradient(135deg, #2563EB, #06B6D4)",
                    boxShadow: "0 0 10px rgba(37,99,235,0.35)",
                  }} />
                  <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 12, fontWeight: 700 }}>InboxIt</span>
                </div>

                {/* All Mail row */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "9px 12px", borderRadius: 10, marginBottom: 6,
                  background: "rgba(255,255,255,0.05)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14 }}>📬</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>All Mail</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                    color: "rgba(255,255,255,0.35)",
                    padding: "2px 6px", borderRadius: 4,
                  }}>127</span>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "10px 12px 12px" }} />
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono', monospace", padding: "0 12px", marginBottom: 8, letterSpacing: "0.1em" }}>
                  SMART FOLDERS
                </div>

                {CATEGORIES.map((cat, i) => {
                  const isActive = i === active;
                  return (
                    <div key={cat.name} className="sidebar-item" style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "9px 12px", borderRadius: 10, marginBottom: 3,
                      background: isActive ? `rgba(${cat.rgba},0.18)` : "transparent",
                      border: isActive ? `1px solid rgba(${cat.rgba},0.25)` : "1px solid transparent",
                      transition: "all 0.4s cubic-bezier(0.16,1,0.3,1)",
                      cursor: "pointer",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13 }}>{cat.icon}</span>
                        <span style={{
                          fontSize: 12,
                          color: isActive ? "white" : "rgba(255,255,255,0.38)",
                          fontWeight: isActive ? 600 : 400,
                          transition: "color 0.3s, font-weight 0.3s",
                        }}>
                          {cat.short}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                        color: isActive ? cat.color : "rgba(255,255,255,0.2)",
                        background: isActive ? `rgba(${cat.rgba},0.22)` : "transparent",
                        padding: "2px 7px", borderRadius: 5,
                        transition: "all 0.3s",
                      }}>
                        {cat.count}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── EMAIL LIST ── */}
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {/* List header */}
                <div style={{
                  padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  flexShrink: 0,
                }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>All Inbox</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {EMAILS.length} of 127 emails
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["Filter", "Unread"].map(btn => (
                      <div key={btn} style={{
                        fontSize: 11, color: "rgba(255,255,255,0.3)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        padding: "5px 12px", borderRadius: 7,
                        background: "rgba(255,255,255,0.02)",
                      }}>{btn}</div>
                    ))}
                  </div>
                </div>

                {/* Email rows */}
                <div style={{ flex: 1, overflowY: "hidden" }}>
                  {EMAILS.map((email, i) => (
                    <div key={i} className="email-row" style={{
                      display: "flex", alignItems: "center", gap: 14,
                      padding: "13px 24px",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      background: i === 0 ? "rgba(255,255,255,0.025)" : "transparent",
                    }}>
                      {/* Unread dot */}
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: i < 2 ? "#60A5FA" : "transparent",
                      }} />
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: `rgba(${email.rgba},0.15)`,
                        border: `1px solid rgba(${email.rgba},0.3)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, color: email.color,
                        fontFamily: "'Unbounded', sans-serif",
                      }}>
                        {email.from[0]}
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: i < 2 ? 600 : 400, color: i < 2 ? "white" : "rgba(255,255,255,0.7)" }}>
                            {email.from}
                          </span>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                            {email.time}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {email.subject}
                        </div>
                      </div>
                      {/* Category badge */}
                      <div style={{
                        fontSize: 10, color: email.color,
                        background: `rgba(${email.rgba},0.15)`,
                        border: `1px solid rgba(${email.rgba},0.25)`,
                        padding: "3px 9px", borderRadius: 5,
                        fontFamily: "'JetBrains Mono', monospace",
                        flexShrink: 0,
                      }}>
                        {email.cat}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom fade */}
          <div style={{
            position: "absolute", inset: 0, top: "40%",
            background: "linear-gradient(to top, #050508 0%, transparent 100%)",
            pointerEvents: "none", zIndex: 10,
          }} />
        </div>
      </main>

      {/* ──── TICKER TAPE ──── */}
      <div style={{
        position: "relative", zIndex: 10, marginTop: 96,
        padding: "28px 0",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        overflow: "hidden",
        background: "rgba(255,255,255,0.01)",
      }}>
        <div style={{
          display: "flex", gap: 0,
          animation: "ticker 22s linear infinite",
          width: "max-content",
        }}>
          {[...Array(2)].flatMap((_, j) =>
            TICKER_ITEMS.map((text, i) => (
              <span key={`${j}-${i}`} style={{
                fontFamily: "'Unbounded', sans-serif",
                fontSize: 11, fontWeight: 700,
                color: "rgba(255,255,255,0.14)",
                letterSpacing: "0.12em", textTransform: "uppercase",
                whiteSpace: "nowrap", padding: "0 32px",
              }}>
                {text}
                <span style={{ color: "rgba(59,130,246,0.4)", marginLeft: 32 }}>✦</span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* ──────────────────────────── FEATURES ──────────────────────────── */}
      <section style={{ position: "relative", zIndex: 10, padding: "128px 48px", maxWidth: 1240, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 80 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "rgba(255,255,255,0.28)", letterSpacing: "0.15em",
            textTransform: "uppercase", marginBottom: 18,
          }}>
            // what makes it different
          </div>
          <h2 style={{
            fontFamily: "'Unbounded', sans-serif",
            fontSize: "clamp(34px, 5.5vw, 60px)",
            fontWeight: 800, letterSpacing: "-0.045em", color: "white",
          }}>
            Not a wrapper.{" "}
            <span style={{
              background: "linear-gradient(125deg, #60A5FA, #8B5CF6)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              An upgrade.
            </span>
          </h2>
        </div>

        <div className="feat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {FEATURES.map((feat, i) => (
            <div
              key={feat.title}
              className="feat-card"
              style={{
                animationDelay: `${0.05 * i}s`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = `rgba(${feat.rgba},0.35)`;
                e.currentTarget.style.background   = `rgba(${feat.rgba},0.06)`;
                e.currentTarget.style.boxShadow    = `0 20px 60px rgba(${feat.rgba},0.1)`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                e.currentTarget.style.background   = "rgba(255,255,255,0.02)";
                e.currentTarget.style.boxShadow    = "none";
              }}
            >
              <div style={{
                width: 50, height: 50, borderRadius: 14,
                background: `rgba(${feat.rgba},0.12)`,
                border: `1px solid rgba(${feat.rgba},0.25)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, marginBottom: 22,
              }}>
                {feat.icon}
              </div>
              <h3 style={{
                fontFamily: "'Unbounded', sans-serif", fontSize: 15,
                fontWeight: 700, marginBottom: 12, letterSpacing: "-0.025em",
              }}>
                {feat.title}
              </h3>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.38)", lineHeight: 1.75 }}>
                {feat.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ──────────────────────────── BOTTOM CTA ──────────────────────────── */}
      <section style={{ position: "relative", zIndex: 10, padding: "0 48px 120px", maxWidth: 1240, margin: "0 auto" }}>
        <div style={{
          padding: "72px 56px",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 28,
          background: "rgba(255,255,255,0.02)",
          backdropFilter: "blur(20px)",
          position: "relative", overflow: "hidden", textAlign: "center",
          animation: "borderGlow 5s ease infinite",
        }}>
          {/* Radial glow inside card */}
          <div style={{
            position: "absolute", top: "-60%", left: "50%", transform: "translateX(-50%)",
            width: "70%", height: "120%",
            background: "radial-gradient(ellipse, rgba(37,99,235,0.14) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />

          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
            color: "rgba(255,255,255,0.28)", marginBottom: 22,
            letterSpacing: "0.12em", textTransform: "uppercase",
          }}>
            JOIN US
          </div>

          <h2 style={{
            fontFamily: "'Unbounded', sans-serif",
            fontSize: "clamp(30px, 4.5vw, 52px)",
            fontWeight: 900, letterSpacing: "-0.045em",
            marginBottom: 18, color: "white",
          }}>
            Take back your inbox.
          </h2>

          <p style={{
            color: "rgba(255,255,255,0.38)", fontSize: 16, marginBottom: 44,
            lineHeight: 1.75, maxWidth: 440, margin: "0 auto 44px",
          }}>
            Free for ALL. Connect your Gmail.<br />
            See it sorted in under 60 seconds.
          </p>

          <Link href="http://localhost:5000/auth/google" className="cta-blue">
            <GoogleLogo white />
            Get Access for Free
          </Link>

          <div style={{
            display: "flex", justifyContent: "center", gap: 32, marginTop: 32, flexWrap: "wrap",
          }}>
            {["No credit card", "OAuth only", "Cancel anytime"].map(t => (
              <span key={t} style={{
                fontSize: 12, color: "rgba(255,255,255,0.25)",
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <span style={{ color: "#10B981" }}>✓</span> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────────────────── FOOTER ──────────────────────────── */}
      <footer style={{
        position: "relative", zIndex: 10,
        borderTop: "1px solid rgba(255,255,255,0.04)",
        padding: "24px 48px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 12, background: "rgba(5,5,8,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: "linear-gradient(135deg, #2563EB, #06B6D4)",
            boxShadow: "0 0 12px rgba(37,99,235,0.35)",
          }} />
          <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 12, fontWeight: 700 }}>InboxIt</span>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.18)" }}>
          © 2025 · Crafted with obsession in India 🇮🇳
        </div>
      </footer>
    </div>
  );
}

// ─── GOOGLE LOGO ─────────────────────────────────────────────────────────────

function GoogleLogo({ white = false }) {
  if (white) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="rgba(255,255,255,0.9)" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="rgba(255,255,255,0.9)" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="rgba(255,255,255,0.9)" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="rgba(255,255,255,0.9)" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
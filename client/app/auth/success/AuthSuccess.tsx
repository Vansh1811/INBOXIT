"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

/**
 * OAuth landing page. The backend sets an HttpOnly cookie during the
 * Google callback redirect — no token is ever passed through the URL.
 * We simply verify the session before entering the dashboard.
 */
export default function AuthSuccess() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    api
      .get("/auth/me")
      .then(() => {
        if (!cancelled) router.replace("/dashboard/inbox");
      })
      .catch(() => {
        if (!cancelled) router.replace("/");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-neutral-400 text-sm">Signing you in...</p>
      </div>
    </div>
  );
}

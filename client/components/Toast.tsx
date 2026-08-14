"use client";

import { useToast } from "@/lib/contexts/ToastContext";
import { Info, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

const typeStyles = {
  info: "border-zinc-800 bg-zinc-900 text-zinc-300",
  success: "border-green-500/20 bg-green-500/10 text-green-400",
  error: "border-red-500/20 bg-red-500/10 text-red-400",
  warning: "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
};

const typeIcons = {
  info: <Info className="w-4 h-4" strokeWidth={1.5} />,
  success: <CheckCircle2 className="w-4 h-4" strokeWidth={1.5} />,
  error: <XCircle className="w-4 h-4" strokeWidth={1.5} />,
  warning: <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />,
};

import { useEffect, useState } from "react";

function ToastItem({ toast, removeToast }: { toast: any; removeToast: (id: string) => void }) {
  const [countdown, setCountdown] = useState(toast.action?.countdown);

  useEffect(() => {
    if (countdown === undefined) return;
    if (countdown <= 0) return;
    
    const timer = setInterval(() => {
      setCountdown((c: number) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  return (
    <div
      className={`animate-slide-up flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${
        typeStyles[toast.type as keyof typeof typeStyles]
      }`}
    >
      <span className="flex-shrink-0">{typeIcons[toast.type as keyof typeof typeIcons]}</span>
      <p className="text-[13px] font-medium flex-1 m-0">{toast.message}</p>
      
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.onClick();
            removeToast(toast.id);
          }}
          className="flex-shrink-0 bg-[var(--text-primary)] text-[var(--bg-base)] border-none text-[12px] font-medium px-3 py-1.5 rounded cursor-pointer transition-colors duration-100 hover:bg-[var(--accent)] outline-none"
        >
          {toast.action.label} {countdown !== undefined ? `(${countdown})` : ""}
        </button>
      )}

      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity bg-transparent border-none cursor-pointer outline-none ml-2"
      >
        <X className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}

export default function Toast() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 max-w-sm w-full px-4 md:px-0">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} removeToast={removeToast} />
      ))}
    </div>
  );
}

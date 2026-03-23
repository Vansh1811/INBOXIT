import { Suspense } from "react";
import AuthSuccess from "./AuthSuccess";

export default function AuthSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Signing you in...</p>
        </div>
      </div>
    }>
      <AuthSuccess />
    </Suspense>
  );
}
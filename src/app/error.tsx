"use client";

import { AlertTriangle } from "lucide-react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-xl border border-[#f0d9d9] bg-[#fdf6f6] p-6">
        <div className="mb-2 flex items-center gap-2 text-[#b91c1c]">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="font-bold">エラーが発生しました</h2>
        </div>
        <p className="break-all text-sm text-[#707070]">{error.message}</p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          再試行
        </button>
      </div>
    </div>
  );
}

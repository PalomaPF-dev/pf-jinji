"use client";

import { Printer } from "lucide-react";

/** 帳票・組織図の印刷ボタン（印刷時は自分自身を隠す）。 */
export default function PrintButton({ label = "印刷" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
    >
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}

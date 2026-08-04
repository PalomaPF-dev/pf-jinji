import { Suspense } from "react";
import PasswordResetConfirmForm from "@/components/PasswordResetConfirmForm";

export const dynamic = "force-dynamic";

export default function PasswordResetConfirmPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-bold text-[#333333]">パスワードの設定</h1>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-6">
          <Suspense fallback={<p className="text-sm text-[#909090]">読み込み中…</p>}>
            <PasswordResetConfirmForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

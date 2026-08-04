import { Suspense } from "react";
import Link from "next/link";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="mx-auto mb-3 h-14 w-14 rounded-xl" />
          <p className="text-[11px] tracking-[0.08em] text-[#707070]">株式会社パロマ</p>
          <h1 className="text-lg font-bold text-[#333333]">PF人事管理</h1>
          <p className="mt-1 text-xs text-[#909090]">生産・調達統括本部（管理者専用）</p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-6">
          <Suspense fallback={<p className="text-sm text-[#909090]">読み込み中…</p>}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-[#909090]">
          パスワードをお忘れの場合は{" "}
          <Link href="/password-reset" className="text-[#2563eb] hover:underline">
            再設定
          </Link>
        </p>
        <p className="mt-6 text-center text-xs text-[#909090]">
          <a href="https://portal.paloma-pf.com/" className="hover:underline">
            ポータルへ戻る
          </a>
        </p>
      </div>
    </main>
  );
}

import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * パスワード再設定の案内。
 *
 * 本アプリは利用者が人事担当者に限られるため、メールでの自己申請は用意していない。
 * 設定リンクは責任者が設定画面（/settings）から発行する。
 */
export default function PasswordResetPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-6 text-center">
          <h1 className="text-lg font-bold text-[#333333]">パスワードの再設定</h1>
          <p className="mt-3 text-sm text-[#707070]">
            人事の責任者に、設定リンクの発行を依頼してください。
            設定画面から利用者ごとにリンクを再発行できます。
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            ログインへ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}

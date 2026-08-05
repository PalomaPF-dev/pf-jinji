import { redirect } from "next/navigation";
import InitialSetupForm from "@/components/InitialSetupForm";
import DbErrorState from "@/components/DbErrorState";
import { isUnconfigured } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 初期セットアップ画面。利用許可名簿が空のときだけ開ける。
 * 既にセットアップ済みならログイン画面へ送る。
 */
export default async function SetupPage() {
  let empty: boolean;
  try {
    empty = await isUnconfigured();
  } catch (e) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <DbErrorState message={(e as Error).message} />
      </main>
    );
  }
  if (!empty) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="mx-auto mb-3 h-14 w-14 rounded-xl" />
          <p className="text-[11px] tracking-[0.08em] text-[#707070]">株式会社パロマ</p>
          <h1 className="text-lg font-bold text-[#333333]">PF人事管理 初期セットアップ</h1>
          <p className="mt-2 text-xs text-[#909090]">
            最初の1人（人事の責任者）を登録します。アプリに入れるのはポータルの管理者ですが、
            給与・人事考課の許可を出す責任者はここで決めます。
          </p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-6">
          <InitialSetupForm />
        </div>
      </div>
    </main>
  );
}

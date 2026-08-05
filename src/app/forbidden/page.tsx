import { ShieldAlert } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";

export const dynamic = "force-dynamic";

const NEED_MESSAGE: Record<string, string> = {
  payroll: "基本給与を閲覧する権限がありません。",
  evaluation: "人事考課を閲覧する権限がありません。",
  owner: "この画面は人事の責任者（利用許可名簿の管理者）のみが開けます。",
};

/**
 * ポータルの管理者権限が無い、または個別権限が足りないときの案内。
 * 「なぜ入れないのか」と「誰に頼めばよいか」だけを出す。人事データは一切表示しない。
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const { need } = await searchParams;
  const session = await getServerSession(authOptions);
  const message =
    (need && NEED_MESSAGE[need]) ??
    "PF人事管理は、ポータルの管理者（管理者権限またはポータル管理権限を持つ方）のみが利用できるアプリです。";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-[#e5e5e5] bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#fdf3e0]">
          <ShieldAlert className="h-6 w-6 text-[#a06a12]" />
        </div>
        <h1 className="text-lg font-bold text-[#333333]">利用が許可されていません</h1>
        <p className="mt-3 text-sm text-[#707070]">{message}</p>
        {session?.user?.loginId && (
          <p className="mt-4 rounded-lg bg-[#f7f7f5] px-3 py-2 text-xs text-[#909090]">
            ログイン中の社員番号: {session.user.loginId}
          </p>
        )}
        <p className="mt-4 text-xs text-[#909090]">
          {need
            ? "この権限が必要な場合は、人事の責任者に利用許可名簿での付与を依頼してください。"
            : "利用が必要な場合は、ポータルの管理者に管理者権限の付与を依頼してください。"}
        </p>
        <a
          href="https://portal.paloma-pf.com/"
          className="mt-6 inline-flex items-center justify-center rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          ポータルへ戻る
        </a>
      </div>
    </main>
  );
}

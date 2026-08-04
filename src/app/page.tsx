import { redirect } from "next/navigation";
import { isUnconfigured, requireJinjiSession } from "@/lib/session";
import DbErrorState from "@/components/DbErrorState";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/** ダッシュボード（P4 で各種サマリーを載せる）。 */
export default async function HomePage() {
  // 名簿が空＝まだ誰も使えない状態。初期セットアップへ誘導する。
  try {
    if (await isUnconfigured()) redirect("/setup");
  } catch (e) {
    // redirect() は内部的に例外を投げるため、DB エラーだけを拾う
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <DbErrorState message={(e as Error).message} />
      </main>
    );
  }

  const s = await requireJinjiSession();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title="ダッシュボード" description={`${s.grant.name} さん、おつかれさまです。`} />
      <p className="text-sm text-[#707070]">各機能はサイドバーから選んでください。</p>
    </main>
  );
}

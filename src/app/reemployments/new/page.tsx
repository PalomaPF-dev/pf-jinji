import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { listReemploymentTargets } from "@/lib/reemploymentOptions";
import PageHeader from "@/components/PageHeader";
import ReemploymentForm from "@/components/ReemploymentForm";
import { createReemploymentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewReemploymentPage() {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const employees = await listReemploymentTargets(scope.orgUnitIds);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="継続雇用申請書の作成"
        description="高齢者雇用・アルバイト契約の満了に伴う継続雇用を申請します（帳票 J-456）。"
        backHref="/reemployments"
        backLabel="一覧へ戻る"
      />
      <ReemploymentForm action={createReemploymentAction} employees={employees} />
    </div>
  );
}

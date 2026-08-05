import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { listTransferTargets } from "@/lib/transferOptions";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import BulkTransferForm from "@/components/BulkTransferForm";
import { createBulkTransferAction } from "../actions";

export const dynamic = "force-dynamic";

/** 一括異動申請（別紙つき）の作成。 */
export default async function BulkTransferPage() {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const today = todayJST();
  const [orgUnits, counts, employees] = await Promise.all([
    listOrgUnits(),
    memberCountsByOrg(),
    listTransferTargets(scope.orgUnitIds),
  ]);
  const orgOptions = flattenTree(buildOrgTree(activeOn(orgUnits, today), counts, new Map()));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="一括異動申請（別紙）"
        description="複数名の異動を1枚の申請書にまとめます。申請書には「別紙参照」と載り、対象者の一覧が別紙になります。"
        backHref="/transfers"
        backLabel="一覧へ戻る"
      />
      <BulkTransferForm action={createBulkTransferAction} employees={employees} orgOptions={orgOptions} />
    </div>
  );
}

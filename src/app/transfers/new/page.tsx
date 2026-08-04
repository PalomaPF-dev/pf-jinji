import { requireJinjiSession } from "@/lib/session";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { listTransferTargets } from "@/lib/transferOptions";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import TransferForm from "@/components/TransferForm";
import { createTransferAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewTransferPage() {
  await requireJinjiSession();
  const today = todayJST();
  const [orgUnits, counts, employees] = await Promise.all([
    listOrgUnits(),
    memberCountsByOrg(),
    listTransferTargets(),
  ]);
  const orgOptions = flattenTree(buildOrgTree(activeOn(orgUnits, today), counts, new Map()));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="異動申請書の作成"
        description="対象者を選ぶと、異動前の欄に人事マスターの現在値が入ります。"
        backHref="/transfers"
        backLabel="一覧へ戻る"
      />
      <TransferForm action={createTransferAction} employees={employees} orgOptions={orgOptions} />
    </div>
  );
}

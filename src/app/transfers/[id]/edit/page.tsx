import { notFound, redirect } from "next/navigation";
import { requireJinjiSession } from "@/lib/session";
import { getTransfer } from "@/lib/transfers";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { listTransferTargets } from "@/lib/transferOptions";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import TransferForm from "@/components/TransferForm";
import { updateTransferAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const transfer = await getTransfer(id);
  if (!transfer) notFound();
  // 申請中・承認済み・発令済みは編集させない（帳票と実態がずれるため）
  if (transfer.status !== "draft" && transfer.status !== "rejected") {
    redirect(`/transfers/${id}`);
  }

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
        title={`${transfer.transferNo} の編集`}
        description={transfer.employeeName}
        backHref={`/transfers/${transfer.id}`}
        backLabel="申請書へ戻る"
      />
      <TransferForm
        action={updateTransferAction}
        transfer={transfer}
        employees={employees}
        orgOptions={orgOptions}
      />
    </div>
  );
}

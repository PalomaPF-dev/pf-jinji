import { notFound, redirect } from "next/navigation";
import { requireJinjiSession } from "@/lib/session";
import { getReemployment } from "@/lib/reemployments";
import { listReemploymentTargets } from "@/lib/reemploymentOptions";
import PageHeader from "@/components/PageHeader";
import ReemploymentForm from "@/components/ReemploymentForm";
import { updateReemploymentAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditReemploymentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const reemployment = await getReemployment(id);
  if (!reemployment) notFound();
  // 申請中・承認済みは編集させない（帳票と実態がずれるため）
  if (reemployment.status !== "draft" && reemployment.status !== "rejected") {
    redirect(`/reemployments/${id}`);
  }

  const employees = await listReemploymentTargets();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title={`${reemployment.docNo} の編集`}
        description={reemployment.employeeName}
        backHref={`/reemployments/${reemployment.id}`}
        backLabel="申請書へ戻る"
      />
      <ReemploymentForm
        action={updateReemploymentAction}
        reemployment={reemployment}
        employees={employees}
      />
    </div>
  );
}

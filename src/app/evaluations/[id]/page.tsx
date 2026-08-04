import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEvaluationSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { getEvaluation, listEvaluationItems, maxTotalOf, totalOf } from "@/lib/evaluations";
import { formatDateTime } from "@/lib/format";
import { EvaluationStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import { FinalizeForm, ScoreForm } from "@/components/EvaluationForms";
import { EVALUATION_HALF_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 1名の考課票。一次・二次を並べて入力し、揃ったら確定する。 */
export default async function EvaluationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireEvaluationSession();
  const { id } = await params;
  const [v, items] = await Promise.all([getEvaluation(id), listEvaluationItems()]);
  if (!v) notFound();

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "view_evaluation",
    targetType: "evaluation",
    targetId: id,
    targetLabel: `${v.period} ${v.employeeName}`,
  });

  const total = totalOf(v, items);
  const maxTotal = maxTotalOf(items);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title={`${v.employeeName} の人事考課`}
        description={`${v.fiscalYear}年度${EVALUATION_HALF_LABEL[v.half]} / ${v.employeeNo} / ${v.orgUnitName ?? "（未配置）"}`}
        backHref="/evaluations"
        backLabel="人事考課へ戻る"
      />

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-[#e5e5e5] bg-white p-4">
        <EvaluationStatusBadge status={v.status} />
        <div>
          <span className="text-xs text-[#909090]">得点 </span>
          <span className="text-lg font-bold text-[#333333]">
            {total} <span className="text-sm font-normal text-[#909090]">/ {maxTotal}</span>
          </span>
        </div>
        <div>
          <span className="text-xs text-[#909090]">総合 </span>
          <span className="text-lg font-bold text-[#333333]">{v.overallRank ?? "—"}</span>
        </div>
        {v.finalizedAt && (
          <span className="text-xs text-[#707070]">{formatDateTime(v.finalizedAt)} に確定</span>
        )}
        <div className="ml-auto">
          {v.status !== "finalized" && <FinalizeForm evaluation={v} />}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ScoreForm evaluation={v} items={items} stage="primary" />
        <ScoreForm evaluation={v} items={items} stage="secondary" />
      </div>

      <div className="mt-5 rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">評価者</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[#909090]">一次評価者</dt>
            <dd className="text-sm text-[#333333]">
              {v.primaryName ?? "—"}
              {v.primaryDoneAt && (
                <span className="ml-2 text-xs text-[#909090]">{formatDateTime(v.primaryDoneAt)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#909090]">二次評価者</dt>
            <dd className="text-sm text-[#333333]">
              {v.secondaryName ?? "—"}
              {v.secondaryDoneAt && (
                <span className="ml-2 text-xs text-[#909090]">{formatDateTime(v.secondaryDoneAt)}</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-[#909090]">
          <Link href={`/employees/${v.employeeId}`} className="text-[#2563eb] hover:underline">
            社員カードを開く
          </Link>
        </p>
      </div>
    </div>
  );
}

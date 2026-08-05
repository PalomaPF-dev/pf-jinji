import Link from "next/link";
import { notFound } from "next/navigation";
import { requireJinjiSession } from "@/lib/session";
import { getOrgPlan, listPlanMoves, PLAN_MARK_LABEL, PLAN_MARK_SIGN } from "@/lib/orgPlans";
import { buildOrgChart } from "@/lib/orgChart";
import { formatDate } from "@/lib/format";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import OrgChartBoard from "@/components/OrgChartBoard";
import {
  DeleteOrgPlanForm,
  EditOrgPlanForm,
  IssueTransfersForm,
  RemoveMoveForm,
} from "@/components/OrgPlanForms";

export const dynamic = "force-dynamic";

/**
 * 異動案の編成画面。組織図の上で人をドラッグして配置を組み替える。
 * 動かした結果は案に溜まるだけで、人事マスターは変わらない。
 */
export default async function OrgPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const plan = await getOrgPlan(id);
  if (!plan) notFound();

  const moves = await listPlanMoves(id);
  const { columns, unassigned } = await buildOrgChart(plan.baseDate ?? todayJST(), moves);
  const editable = plan.status === "draft";

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8">
      <PageHeader
        title={plan.name}
        description={`基準日 ${formatDate(plan.baseDate)} / 発令予定日 ${formatDate(plan.effectiveDate)} / ${plan.moveCount} 名`}
        backHref="/org/plan"
        backLabel="異動案の一覧へ"
        actions={<PrintButton label="配置表を印刷" />}
      />

      {plan.status === "applied" && (
        <p className="no-print mb-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">
          この案からは異動申請書を作成済みです。以後の編集はできません。各申請書は
          <Link href="/transfers" className="mx-1 underline">
            異動申請書
          </Link>
          から申請・承認・発令へ進めてください。
        </p>
      )}

      {/* 配置表（印刷対象） */}
      <section className="mb-6 rounded-xl border border-[#e5e5e5] bg-white p-4">
        <OrgChartBoard
          columns={columns}
          unassigned={unassigned}
          planId={plan.id}
          editable={editable}
        />
      </section>

      {/* 動かした人の一覧 */}
      <section className="no-print mb-6 rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">この案で動かす人（{moves.length} 名）</h2>
        {moves.length === 0 ? (
          <p className="text-sm text-[#909090]">
            まだ誰も動かしていません。上の配置表で氏名をつかんで、移したい部署へ落としてください。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e5] text-left text-xs text-[#707070]">
                  <th className="px-2 py-2 font-medium">印</th>
                  <th className="px-2 py-2 font-medium">氏名</th>
                  <th className="px-2 py-2 font-medium">現所属</th>
                  <th className="px-2 py-2 font-medium">異動先</th>
                  <th className="px-2 py-2 font-medium">役職</th>
                  <th className="px-2 py-2 font-medium">職務</th>
                  <th className="px-2 py-2 font-medium">申請書</th>
                  <th className="px-2 py-2 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id} className="border-b border-[#f0f0f0] last:border-0">
                    <td className="px-2 py-2 text-center" title={PLAN_MARK_LABEL[m.mark]}>
                      {PLAN_MARK_SIGN[m.mark]}
                    </td>
                    <td className="px-2 py-2 text-[#333333]">
                      <Link href={`/employees/${m.employeeId}`} className="hover:text-[#2563eb] hover:underline">
                        {m.employeeName}
                      </Link>
                      <div className="text-xs text-[#909090]">{m.employeeNo}</div>
                    </td>
                    <td className="px-2 py-2 text-[#707070]">{m.fromOrgUnitName ?? "—"}</td>
                    <td className="px-2 py-2 font-medium text-[#333333]">{m.toOrgUnitName ?? "—"}</td>
                    <td className="px-2 py-2 text-[#555555]">
                      {m.toPosition ? `${m.fromPosition ?? "—"} → ${m.toPosition}` : m.fromPosition ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-[#555555]">
                      {m.toDuty ? `${m.fromDuty ?? "—"} → ${m.toDuty}` : m.fromDuty ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      {m.transferId ? (
                        <Link href={`/transfers/${m.transferId}`} className="text-xs text-[#2563eb] hover:underline">
                          作成済
                        </Link>
                      ) : (
                        <span className="text-xs text-[#909090]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {editable && <RemoveMoveForm planId={plan.id} employeeId={m.employeeId} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editable && (
        <>
          <section className="no-print mb-6 rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-3 text-sm font-bold text-[#333333]">案の設定</h2>
            <EditOrgPlanForm plan={plan} />
          </section>

          <section className="no-print flex flex-wrap items-start gap-3 rounded-xl border border-[#e5e5e5] bg-white p-5">
            <div className="mr-auto">
              <h2 className="mb-1 text-sm font-bold text-[#333333]">確定する</h2>
              <p className="text-xs text-[#707070]">
                動かした人ぶんの異動申請書を<strong>起案中</strong>で作成します。人事マスターへの反映は、
                各申請書を申請・承認・発令まで進めたときです。
              </p>
            </div>
            <IssueTransfersForm plan={plan} />
            <DeleteOrgPlanForm plan={plan} />
          </section>
        </>
      )}

      <style>{`@media print { @page { size: A3 landscape; margin: 8mm; } }`}</style>
    </div>
  );
}

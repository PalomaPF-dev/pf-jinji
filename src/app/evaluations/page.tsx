import Link from "next/link";
import { requireEvaluationSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { listEvaluationItems, listEvaluations, listPeriods, maxTotalOf } from "@/lib/evaluations";
import { getEmployee } from "@/lib/employees";
import { fiscalHalfOf, fiscalYearOf, todayJST } from "@/lib/dates";
import { EvaluationStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { OpenPeriodForm } from "@/components/EvaluationForms";
import { EVALUATION_HALF_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 人事考課の一覧。評価期で切り替える。can_evaluation を持つ人だけが開ける。 */
export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; employee?: string }>;
}) {
  const s = await requireEvaluationSession();
  const { period = "", employee = "" } = await searchParams;
  const today = todayJST();

  const [periods, items, target] = await Promise.all([
    listPeriods(),
    listEvaluationItems(),
    employee ? getEmployee(employee) : Promise.resolve(null),
  ]);
  const selected = period || periods[0]?.period || "";
  const evaluations = await listEvaluations(employee ? null : selected || null, employee || null);
  const maxTotal = maxTotalOf(items);

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "view_evaluation",
    targetType: "evaluation",
    targetLabel: target ? `${target.employeeNo} ${target.name}` : `評価期 ${selected || "（未選択）"}`,
    detail: { count: evaluations.length },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title={target ? `${target.name} の人事考課` : "人事考課"}
        description={`${evaluations.length} 件`}
        backHref={target ? `/employees/${target.id}` : undefined}
        backLabel={target ? "社員カードへ戻る" : undefined}
      />

      {!target && (
        <div className="mb-5 space-y-4">
          <OpenPeriodForm defaultYear={fiscalYearOf(today)} defaultHalf={fiscalHalfOf(today)} />

          {periods.length > 0 && (
            <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
              <div>
                <label htmlFor="period" className="mb-1 block text-xs font-medium text-[#707070]">
                  評価期
                </label>
                <select
                  id="period"
                  name="period"
                  defaultValue={selected}
                  className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
                >
                  {periods.map((p) => (
                    <option key={p.period} value={p.period}>
                      {p.period.slice(0, 4)}年度
                      {EVALUATION_HALF_LABEL[p.period.slice(4) as "H1" | "H2"]}（{p.count}名）
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
              >
                表示する
              </button>
            </form>
          )}
        </div>
      )}

      {evaluations.length === 0 ? (
        <EmptyState
          title="考課の対象がありません"
          description="「評価期を開く」から、在籍者ぶんの評価票を用意してください。"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">評価期</th>
                <th className="px-4 py-3 font-medium">氏名</th>
                <th className="px-4 py-3 font-medium">所属</th>
                <th className="px-4 py-3 text-right font-medium">得点</th>
                <th className="px-4 py-3 font-medium">総合</th>
                <th className="px-4 py-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((v) => (
                <tr key={v.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3 text-xs text-[#707070]">
                    {v.fiscalYear}年度{EVALUATION_HALF_LABEL[v.half]}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/evaluations/${v.id}`} className="font-medium text-[#2563eb] hover:underline">
                      {v.employeeName}
                    </Link>
                    <div className="text-xs text-[#909090]">{v.employeeNo}</div>
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{v.orgUnitName ?? "（未配置）"}</td>
                  <td className="px-4 py-3 text-right text-[#333333]">
                    {v.totalScore == null ? "—" : `${v.totalScore} / ${maxTotal}`}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#333333]">{v.overallRank ?? "—"}</td>
                  <td className="px-4 py-3">
                    <EvaluationStatusBadge status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

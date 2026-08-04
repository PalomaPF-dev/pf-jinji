import { notFound } from "next/navigation";
import { requirePayrollSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { listSalaryHistory } from "@/lib/salaries";
import { getEmployee } from "@/lib/employees";
import { formatDate, formatYearMonth, formatYen } from "@/lib/format";
import { salaryTotal } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import SalaryRevisionForm, { VoidSalaryForm } from "@/components/SalaryForms";

export const dynamic = "force-dynamic";

/** 1社員の給与改定履歴と、新しい改定の登録。 */
export default async function EmployeeSalaryPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const s = await requirePayrollSession();
  const { employeeId } = await params;
  const employee = await getEmployee(employeeId);
  if (!employee) notFound();
  const history = await listSalaryHistory(employeeId);

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "view_payroll",
    targetType: "employee",
    targetId: employeeId,
    targetLabel: `${employee.employeeNo} ${employee.name}`,
  });

  // 有効な行のうち最も新しいものが現在の給与
  const current = history.find((h) => !h.voidedAt) ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title={`${employee.name} の基本給与`}
        description={`${employee.employeeNo} / ${employee.orgUnitName ?? "（未配置）"}`}
        backHref="/salaries"
        backLabel="基本給与へ戻る"
      />

      <section className="mb-5 rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">現在の給与</h2>
        {current ? (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="text-xs text-[#909090]">基本給</div>
              <div className="text-2xl font-bold text-[#333333]">{formatYen(current.baseSalary)}</div>
            </div>
            <div>
              <div className="text-xs text-[#909090]">支給計（基本給＋手当）</div>
              <div className="text-lg font-medium text-[#333333]">{formatYen(salaryTotal(current))}</div>
            </div>
            <div>
              <div className="text-xs text-[#909090]">適用開始</div>
              <div className="text-sm text-[#555555]">{formatYearMonth(current.effectiveFrom)}</div>
            </div>
            <div>
              <div className="text-xs text-[#909090]">等級 / 号俸</div>
              <div className="text-sm text-[#555555]">
                {[current.grade, current.step].filter(Boolean).join(" / ") || "—"}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#909090]">まだ登録がありません。下の欄から登録してください。</p>
        )}
        {current && current.allowances.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {current.allowances.map((a, i) => (
              <li key={i} className="rounded-full bg-[#f0f0f0] px-2.5 py-1 text-xs text-[#555555]">
                {a.name} {formatYen(a.amount)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">改定履歴</h2>
        {history.length === 0 ? (
          <EmptyState title="改定履歴がありません" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                  <th className="px-4 py-3 font-medium">適用開始</th>
                  <th className="px-4 py-3 font-medium">区分</th>
                  <th className="px-4 py-3 text-right font-medium">基本給</th>
                  <th className="px-4 py-3 text-right font-medium">支給計</th>
                  <th className="px-4 py-3 font-medium">決裁</th>
                  <th className="px-4 py-3 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.id}
                    className={`border-b border-[#f0f0f0] last:border-0 ${h.voidedAt ? "bg-[#fafafa] text-[#b0b0b0] line-through" : ""}`}
                  >
                    <td className="px-4 py-3">{formatYearMonth(h.effectiveFrom)}</td>
                    <td className="px-4 py-3">
                      {h.revisionKind}
                      {h.reason && <div className="text-xs text-[#909090] no-underline">{h.reason}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">{formatYen(h.baseSalary)}</td>
                    <td className="px-4 py-3 text-right">{formatYen(salaryTotal(h))}</td>
                    <td className="px-4 py-3 text-xs">
                      {h.decidedName ?? "—"}
                      <div className="text-[#909090]">{formatDate(h.createdAt?.slice(0, 10) ?? null)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {h.voidedAt ? (
                        <span className="text-xs text-[#b0b0b0]">取消済</span>
                      ) : (
                        <VoidSalaryForm
                          id={h.id}
                          employeeId={employeeId}
                          label={formatYearMonth(h.effectiveFrom)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SalaryRevisionForm employeeId={employeeId} defaultGrade={employee.grade} />
    </div>
  );
}

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePayrollSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { listCurrentSalaries } from "@/lib/salaries";
import { todayJST } from "@/lib/dates";
import { formatYen, formatYearMonth } from "@/lib/format";
import { salaryTotal } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

/**
 * 基本給与の一覧（現在値）。can_payroll を持つ人だけが開ける。
 * 給与は最も機微なので、**閲覧そのものを監査ログに残す**。
 */
export default async function SalariesPage() {
  const s = await requirePayrollSession();
  const today = todayJST();
  const rows = await listCurrentSalaries(today);

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "view_payroll",
    targetType: "salary",
    targetLabel: "給与一覧",
    detail: { count: rows.length, asOf: today },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title="基本給与" description={`${formatYearMonth(today)} 時点の現在値 / ${rows.length} 名`} />

      <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#e5e5e5] bg-[#f7f9ff] p-4 text-xs text-[#3b4fa8]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          給与情報は閲覧・更新のすべてを監査ログに記録しています。
          社員名をクリックすると改定履歴の確認と新しい改定の登録ができます。
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="社員が登録されていません" description="先に社員台帳を整備してください。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">社員番号</th>
                <th className="px-4 py-3 font-medium">氏名</th>
                <th className="px-4 py-3 font-medium">所属</th>
                <th className="px-4 py-3 font-medium">等級/号俸</th>
                <th className="px-4 py-3 text-right font-medium">基本給</th>
                <th className="px-4 py-3 text-right font-medium">支給計</th>
                <th className="px-4 py-3 font-medium">適用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3 font-mono text-xs text-[#707070]">{r.employeeNo}</td>
                  <td className="px-4 py-3">
                    <Link href={`/salaries/${r.employeeId}`} className="font-medium text-[#2563eb] hover:underline">
                      {r.employeeName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{r.orgUnitName ?? "（未配置）"}</td>
                  <td className="px-4 py-3 text-[#707070]">
                    {r.salary ? [r.salary.grade, r.salary.step].filter(Boolean).join(" / ") || "—" : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[#333333]">
                    {r.salary ? formatYen(r.salary.baseSalary) : <span className="text-[#c0392b]">未登録</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-[#333333]">
                    {r.salary ? formatYen(salaryTotal(r.salary)) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#909090]">
                    {r.salary ? formatYearMonth(r.salary.effectiveFrom) : "—"}
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

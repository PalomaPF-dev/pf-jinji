import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { listEmployees } from "@/lib/employees";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import { ageAt, formatDate } from "@/lib/format";
import { EmploymentStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUS_ORDER, type EmploymentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 社員台帳の一覧。検索・所属・在籍状態で絞り込む。 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; org?: string; status?: string }>;
}) {
  await requireJinjiSession();
  const { q = "", org = "", status = "active" } = await searchParams;
  const today = todayJST();

  const [employees, orgUnits, counts] = await Promise.all([
    listEmployees({
      q,
      orgUnitId: org || null,
      status: (status === "all" ? "all" : status) as EmploymentStatus | "all",
    }),
    listOrgUnits(),
    memberCountsByOrg(),
  ]);
  const orgOptions = flattenTree(buildOrgTree(activeOn(orgUnits, today), counts, new Map()));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="社員台帳"
        description={`${employees.length} 件`}
        actions={
          <>
            <Link
              href="/employees/import"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Upload className="h-4 w-4" />
              CSV取込
            </Link>
            <a
              href={`/api/employees/export?q=${encodeURIComponent(q)}&org=${encodeURIComponent(org)}&status=${encodeURIComponent(status)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Download className="h-4 w-4" />
              CSV出力
            </a>
            <Link
              href="/employees/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              <Plus className="h-4 w-4" />
              新規登録
            </Link>
          </>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-[#707070]">
            検索（社員番号・氏名・カナ・役職）
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <div>
          <label htmlFor="org" className="mb-1 block text-xs font-medium text-[#707070]">
            所属
          </label>
          <select
            id="org"
            name="org"
            defaultValue={org}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="">すべて</option>
            {orgOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {"　".repeat(o.depth)}
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-[#707070]">
            在籍状態
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            {EMPLOYMENT_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {EMPLOYMENT_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="all">すべて</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          絞り込む
        </button>
      </form>

      {employees.length === 0 ? (
        <EmptyState
          title="該当する社員がいません"
          description="条件を変えるか、新規登録・CSV取込から社員を追加してください。"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">社員番号</th>
                <th className="px-4 py-3 font-medium">氏名</th>
                <th className="px-4 py-3 font-medium">所属</th>
                <th className="px-4 py-3 font-medium">役職</th>
                <th className="px-4 py-3 font-medium">入社日</th>
                <th className="px-4 py-3 font-medium">年齢</th>
                <th className="px-4 py-3 font-medium">在籍</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3 font-mono text-xs text-[#707070]">{e.employeeNo}</td>
                  <td className="px-4 py-3">
                    <Link href={`/employees/${e.id}`} className="font-medium text-[#2563eb] hover:underline">
                      {e.name}
                    </Link>
                    {e.nameKana && <div className="text-xs text-[#909090]">{e.nameKana}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{e.orgUnitName ?? "（未配置）"}</td>
                  <td className="px-4 py-3 text-[#555555]">{e.positionName ?? "—"}</td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(e.hireDate)}</td>
                  <td className="px-4 py-3 text-[#707070]">{ageAt(e.birthDate, today) ?? "—"}</td>
                  <td className="px-4 py-3">
                    <EmploymentStatusBadge status={e.status} />
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

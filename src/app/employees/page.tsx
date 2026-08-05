import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { listEmployees, normalizeEmployeeSort, type EmployeeSortKey } from "@/lib/employees";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import { ageAt, formatDate } from "@/lib/format";
import { EmploymentStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_STATUS_ORDER, type EmploymentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 並び替えのできる見出し。押すたびに 昇順 → 降順 を切り替える。
 * 絞り込みの条件（検索語・所属・在籍）はリンクに引き継ぐ。
 */
function SortTh({
  label,
  col,
  sort,
  desc,
  params,
}: {
  label: string;
  col: EmployeeSortKey;
  sort: EmployeeSortKey;
  desc: boolean;
  params: Record<string, string>;
}) {
  const active = sort === col;
  const nextDesc = active && !desc;
  const qs = new URLSearchParams({ ...params, sort: col, ...(nextDesc ? { desc: "1" } : {}) });
  return (
    <th className="px-3 py-2 font-medium">
      <Link
        href={`/employees?${qs.toString()}`}
        className={`inline-flex items-center gap-0.5 hover:text-[#2563eb] ${active ? "text-[#2563eb]" : ""}`}
      >
        {label}
        <span className="text-[9px]">{active ? (desc ? "▼" : "▲") : "↕"}</span>
      </Link>
    </th>
  );
}

/** 社員台帳の一覧。検索・所属・在籍状態で絞り込む。 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    org?: string;
    status?: string;
    sort?: string;
    desc?: string;
  }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const { q = "", org = "", status = "active", sort: sortRaw, desc: descRaw } = await searchParams;
  const today = todayJST();
  const sort = normalizeEmployeeSort(sortRaw);
  const desc = descRaw === "1";
  const sortProps = { sort, desc, params: { q, org, status } };

  const [employees, orgUnits, counts] = await Promise.all([
    listEmployees({
      q,
      orgUnitId: org || null,
      status: (status === "all" ? "all" : status) as EmploymentStatus | "all",
      scopeOrgIds: scope.orgUnitIds,
      sort,
      desc,
    }),
    listOrgUnits(),
    memberCountsByOrg(),
  ]);
  const orgOptions = flattenTree(buildOrgTree(activeOn(orgUnits, today), counts, new Map())).filter(
    (o) => scope.orgUnitIds === null || scope.orgUnitIds.includes(o.id),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="社員台帳"
        description={
          scope.scopeName ? `${scope.scopeName} の ${employees.length} 件` : `${employees.length} 件`
        }
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
              href={`/api/employees/export?q=${encodeURIComponent(q)}&org=${encodeURIComponent(org)}&status=${encodeURIComponent(status)}&sort=${sort}${desc ? "&desc=1" : ""}`}
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

      {scope.unresolved && (
        <p className="mb-4 rounded-xl border border-[#f0e2c8] bg-[#fdfaf3] p-4 text-xs text-[#a06a12]">
          ご自身の社員番号が社員台帳に見つからないため、表示範囲（工場）を特定できませんでした。
          ポータル管理者にお問い合わせください。
        </p>
      )}

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
        {/* 絞り込みを変えても並び順は保つ */}
        <input type="hidden" name="sort" value={sort} />
        {desc && <input type="hidden" name="desc" value="1" />}
        <div className="min-w-[180px] flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-[#707070]">
            検索（社員番号・氏名・カナ・役職・職務）
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
          <table className="w-full min-w-[900px] text-[13px] leading-5">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <SortTh label="社員番号" col="employeeNo" {...sortProps} />
                <SortTh label="氏名" col="name" {...sortProps} />
                <SortTh label="所属" col="org" {...sortProps} />
                <SortTh label="役職" col="position" {...sortProps} />
                <SortTh label="職務" col="duty" {...sortProps} />
                <SortTh label="入社日" col="hireDate" {...sortProps} />
                <SortTh label="年齢" col="birthDate" {...sortProps} />
                <SortTh label="在籍" col="status" {...sortProps} />
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-3 py-1 font-mono text-[11px] text-[#707070]">{e.employeeNo}</td>
                  <td className="px-3 py-1 whitespace-nowrap">
                    <Link href={`/employees/${e.id}`} className="font-medium text-[#2563eb] hover:underline">
                      {e.name}
                    </Link>
                    {e.nameKana && <span className="ml-2 text-xs text-[#909090]">{e.nameKana}</span>}
                  </td>
                  <td className="px-3 py-1 text-[#555555]">{e.orgUnitName ?? "（未配置）"}</td>
                  <td className="px-3 py-1 text-[#555555]">{e.positionName ?? "—"}</td>
                  <td className="px-3 py-1 text-[#555555]">{e.dutyName ?? "—"}</td>
                  <td className="px-3 py-1 whitespace-nowrap text-[#707070]">{formatDate(e.hireDate)}</td>
                  <td className="px-3 py-1 text-[#707070]">{ageAt(e.birthDate, today) ?? "—"}</td>
                  <td className="px-3 py-1">
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

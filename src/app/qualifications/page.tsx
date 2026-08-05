import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { listQualificationMasters, listQualifications } from "@/lib/qualifications";
import { listEmployeeOptions, getEmployee } from "@/lib/employees";
import { daysUntil, todayJST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { ExpiryBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import QualificationForm, { DeleteQualificationForm } from "@/components/QualificationForms";
import { QUALIFICATION_CATEGORY_LABEL, type QualificationCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 保有資格の一覧と登録。期限が近いものが上に来る。 */
export default async function QualificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; category?: string; expiring?: string }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const { employee = "", category = "all", expiring = "" } = await searchParams;
  const today = todayJST();

  const [list, employees, masters, target] = await Promise.all([
    listQualifications({
      employeeId: employee || null,
      category: (category === "all" ? "all" : category) as QualificationCategory | "all",
      expiringOnly: expiring === "1",
      today,
      scopeOrgIds: scope.orgUnitIds,
    }),
    listEmployeeOptions(scope.orgUnitIds),
    listQualificationMasters(),
    employee ? getEmployee(employee) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title={target ? `${target.name} の保有資格` : "資格"}
        description={`${list.length} 件`}
        backHref={target ? `/employees/${target.id}` : undefined}
        backLabel={target ? "社員カードへ戻る" : undefined}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
        {employee && <input type="hidden" name="employee" value={employee} />}
        <div>
          <label htmlFor="category" className="mb-1 block text-xs font-medium text-[#707070]">
            区分
          </label>
          <select
            id="category"
            name="category"
            defaultValue={category}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="all">すべて</option>
            {(Object.keys(QUALIFICATION_CATEGORY_LABEL) as (keyof typeof QUALIFICATION_CATEGORY_LABEL)[]).map(
              (c) => (
                <option key={c} value={c}>
                  {QUALIFICATION_CATEGORY_LABEL[c]}
                </option>
              ),
            )}
          </select>
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-[#555555]">
          <input type="checkbox" name="expiring" value="1" defaultChecked={expiring === "1"} />
          期限が近い・切れているものだけ
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          絞り込む
        </button>
      </form>

      {list.length === 0 ? (
        <EmptyState title="該当する資格がありません" description="下の欄から登録してください。" />
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">氏名</th>
                <th className="px-4 py-3 font-medium">所属</th>
                <th className="px-4 py-3 font-medium">資格</th>
                <th className="px-4 py-3 font-medium">区分</th>
                <th className="px-4 py-3 font-medium">取得日</th>
                <th className="px-4 py-3 font-medium">有効期限</th>
                <th className="px-4 py-3 font-medium">残り</th>
                <th className="px-4 py-3 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3 text-[#333333]">
                    {q.employeeName}
                    <div className="text-xs text-[#909090]">{q.employeeNo}</div>
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{q.orgUnitName ?? "（未配置）"}</td>
                  <td className="px-4 py-3 text-[#333333]">
                    {q.name}
                    {q.certificateNo && <div className="text-xs text-[#909090]">No.{q.certificateNo}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{QUALIFICATION_CATEGORY_LABEL[q.category]}</td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(q.acquiredOn)}</td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(q.expiresOn)}</td>
                  <td className="px-4 py-3">
                    <ExpiryBadge daysLeft={q.expiresOn ? daysUntil(q.expiresOn, today) : null} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeleteQualificationForm id={q.id} label={`${q.employeeName} / ${q.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QualificationForm
        employees={employees}
        masters={masters}
        defaultEmployeeId={employee || undefined}
      />
    </div>
  );
}

import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import {
  countByQualification,
  listQualificationGroups,
  listQualificationMasters,
  listQualifications,
} from "@/lib/qualifications";
import { listEmployeeOptions, getEmployee } from "@/lib/employees";
import { daysUntil, todayJST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { ExpiryBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import QualificationForm, { DeleteQualificationForm } from "@/components/QualificationForms";
import QualificationImportForm from "@/components/QualificationImportForm";
import { QUALIFICATION_CATEGORY_LABEL, type QualificationCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 一覧に出す上限。全件（数千行）を描くと画面が持たないため。 */
const LIMIT = 500;

/** 保有資格の一覧と登録。期限が近いものが上に来る。 */
export default async function QualificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    employee?: string;
    category?: string;
    group?: string;
    code?: string;
    q?: string;
    expiring?: string;
  }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const {
    employee = "",
    category = "all",
    group = "all",
    code = "all",
    q = "",
    expiring = "",
  } = await searchParams;
  const today = todayJST();

  const [list, employees, masters, groups, byQual, target] = await Promise.all([
    listQualifications({
      employeeId: employee || null,
      category: (category === "all" ? "all" : category) as QualificationCategory | "all",
      group,
      code,
      keyword: q,
      expiringOnly: expiring === "1",
      today,
      scopeOrgIds: scope.orgUnitIds,
      limit: LIMIT,
    }),
    listEmployeeOptions(scope.orgUnitIds),
    listQualificationMasters(),
    listQualificationGroups(),
    countByQualification(scope.orgUnitIds),
    employee ? getEmployee(employee) : Promise.resolve(null),
  ]);

  const shown = list.rows.length;
  const description = target
    ? `${list.total} 件`
    : `${list.total} 件${list.total > shown ? `（うち ${shown} 件を表示）` : ""}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title={target ? `${target.name} の保有資格` : "資格"}
        description={description}
        backHref={target ? `/employees/${target.id}` : undefined}
        backLabel={target ? "社員カードへ戻る" : undefined}
      />

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4"
      >
        {employee && <input type="hidden" name="employee" value={employee} />}
        <div>
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-[#707070]">
            氏名・社員番号・資格名
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="部分一致"
            className="w-52 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <div>
          <label htmlFor="code" className="mb-1 block text-xs font-medium text-[#707070]">
            資格
          </label>
          <select
            id="code"
            name="code"
            defaultValue={code}
            className="w-72 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="all">すべて</option>
            {byQual.map((x) => (
              <option key={`${x.code}|${x.name}`} value={x.code}>
                {x.code ? `${x.code} ` : ""}
                {x.name}（{x.holders}名）
              </option>
            ))}
          </select>
        </div>
        {groups.length > 0 && (
          <div>
            <label htmlFor="group" className="mb-1 block text-xs font-medium text-[#707070]">
              区分（人事システム）
            </label>
            <select
              id="group"
              name="group"
              defaultValue={group}
              className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            >
              <option value="all">すべて</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="category" className="mb-1 block text-xs font-medium text-[#707070]">
            種別
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

      {list.rows.length === 0 ? (
        <EmptyState
          title="該当する資格がありません"
          description="下の欄から登録するか、資格取得状況のExcelを取り込んでください。"
        />
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[940px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-3 py-2 font-medium">氏名</th>
                <th className="px-3 py-2 font-medium">所属</th>
                <th className="px-3 py-2 font-medium">資格</th>
                <th className="px-3 py-2 font-medium">区分</th>
                <th className="px-3 py-2 font-medium">役割</th>
                <th className="px-3 py-2 font-medium">取得日</th>
                <th className="px-3 py-2 font-medium">有効期限</th>
                <th className="px-3 py-2 font-medium">残り</th>
                <th className="px-3 py-2 font-medium">手当</th>
                <th className="px-3 py-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((qq) => (
                <tr key={qq.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-3 py-2 text-[#333333]">
                    {qq.employeeName}
                    <div className="text-xs text-[#909090]">{qq.employeeNo}</div>
                  </td>
                  <td className="px-3 py-2 text-[#555555]">{qq.orgUnitName ?? "（未配置）"}</td>
                  <td className="px-3 py-2 text-[#333333]">
                    {qq.name}
                    {qq.code && <div className="font-mono text-xs text-[#909090]">{qq.code}</div>}
                    {qq.certificateNo && <div className="text-xs text-[#909090]">No.{qq.certificateNo}</div>}
                  </td>
                  <td className="px-3 py-2 text-[#555555]">
                    {qq.groupName ?? QUALIFICATION_CATEGORY_LABEL[qq.category]}
                  </td>
                  <td className="px-3 py-2 text-[#555555]">{qq.holderRole ?? "—"}</td>
                  <td className="px-3 py-2 text-[#707070]">{formatDate(qq.acquiredOn)}</td>
                  <td className="px-3 py-2 text-[#707070]">{formatDate(qq.expiresOn)}</td>
                  <td className="px-3 py-2">
                    <ExpiryBadge daysLeft={qq.expiresOn ? daysUntil(qq.expiresOn, today) : null} />
                  </td>
                  <td className="px-3 py-2 text-[#707070]">
                    {qq.allowancePaid == null ? "—" : qq.allowancePaid ? "支給" : "なし"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeleteQualificationForm id={qq.id} label={`${qq.employeeName} / ${qq.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.total > shown && (
        <p className="mb-6 text-xs text-[#909090]">
          {list.total} 件のうち {shown} 件を表示しています。上の欄で絞り込んでください。
        </p>
      )}

      <QualificationForm
        employees={employees}
        masters={masters}
        defaultEmployeeId={employee || undefined}
      />

      <div className="mt-6">
        <QualificationImportForm />
      </div>
    </div>
  );
}

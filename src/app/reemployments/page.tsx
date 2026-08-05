import Link from "next/link";
import { Plus } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { listReemployments } from "@/lib/reemployments";
import { getEmployee } from "@/lib/employees";
import { formatDate } from "@/lib/format";
import { ReemploymentStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { REEMPLOYMENT_STATUS_LABEL, type ReemploymentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: ReemploymentStatus[] = ["draft", "submitted", "approved", "rejected"];

/**
 * 継続雇用申請書（指定帳票 J-456）の一覧。
 * 社員カードからは ?employee=<id> で本人の申請履歴として開かれる。
 */
export default async function ReemploymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; status?: string; q?: string }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const { employee = "", status = "all", q = "" } = await searchParams;

  const [items, target] = await Promise.all([
    listReemployments({
      employeeId: employee || null,
      status: (status === "all" ? "all" : status) as ReemploymentStatus | "all",
      q,
      scopeOrgIds: scope.orgUnitIds,
    }),
    employee ? getEmployee(employee) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title={target ? `${target.name} の継続雇用申請` : "継続雇用申請書"}
        description={`${items.length} 件`}
        backHref={target ? `/employees/${target.id}` : undefined}
        backLabel={target ? "社員カードへ戻る" : undefined}
        actions={
          <Link
            href="/reemployments/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
          >
            <Plus className="h-4 w-4" />
            申請書を作成
          </Link>
        }
      />

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4"
      >
        {employee && <input type="hidden" name="employee" value={employee} />}
        <div className="min-w-[180px] flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-[#707070]">
            検索（書類番号・氏名・社員番号）
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-[#707070]">
            状態
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="all">すべて</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {REEMPLOYMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          絞り込む
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="継続雇用申請がありません"
          description="高齢者雇用・アルバイト契約の満了に伴う継続雇用は、ここから起案します。"
          action={
            <Link
              href="/reemployments/new"
              className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              申請書を作成
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">書類番号</th>
                <th className="px-4 py-3 font-medium">対象者</th>
                <th className="px-4 py-3 font-medium">所属</th>
                <th className="px-4 py-3 font-medium">契約満了日</th>
                <th className="px-4 py-3 font-medium">継続する契約期間</th>
                <th className="px-4 py-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/reemployments/${r.id}`}
                      className="font-mono text-xs font-medium text-[#2563eb] hover:underline"
                    >
                      {r.docNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#333333]">
                    {r.employeeName}
                    <div className="text-xs text-[#909090]">{r.employeeNo}</div>
                  </td>
                  <td className="px-4 py-3 text-[#707070]">{r.orgUnitName ?? "—"}</td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(r.contractEndDate)}</td>
                  <td className="px-4 py-3 text-[#555555]">
                    {r.periodFrom || r.periodTo
                      ? `${formatDate(r.periodFrom)} 〜 ${formatDate(r.periodTo)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ReemploymentStatusBadge status={r.status} />
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

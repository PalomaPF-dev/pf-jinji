import Link from "next/link";
import { Plus } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { listTransfers } from "@/lib/transfers";
import { getEmployee } from "@/lib/employees";
import { formatDate } from "@/lib/format";
import { TransferStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { TRANSFER_KIND_LABEL, TRANSFER_STATUS_LABEL, type TransferStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: TransferStatus[] = ["draft", "submitted", "approved", "issued", "rejected"];

/** 異動申請の一覧。社員カードからは ?employee=<id> で異動履歴として開かれる。 */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; status?: string; q?: string }>;
}) {
  await requireJinjiSession();
  const { employee = "", status = "all", q = "" } = await searchParams;

  const [transfers, target] = await Promise.all([
    listTransfers({
      employeeId: employee || null,
      status: (status === "all" ? "all" : status) as TransferStatus | "all",
      q,
    }),
    employee ? getEmployee(employee) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title={target ? `${target.name} の異動履歴` : "異動申請書"}
        description={`${transfers.length} 件`}
        backHref={target ? `/employees/${target.id}` : undefined}
        backLabel={target ? "社員カードへ戻る" : undefined}
        actions={
          <Link
            href="/transfers/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
          >
            <Plus className="h-4 w-4" />
            申請書を作成
          </Link>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
        {employee && <input type="hidden" name="employee" value={employee} />}
        <div className="min-w-[180px] flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-[#707070]">
            検索（申請番号・氏名・社員番号）
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
                {TRANSFER_STATUS_LABEL[s]}
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

      {transfers.length === 0 ? (
        <EmptyState
          title="異動申請がありません"
          description="「申請書を作成」から起案してください。"
          action={
            <Link
              href="/transfers/new"
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
                <th className="px-4 py-3 font-medium">申請番号</th>
                <th className="px-4 py-3 font-medium">対象者</th>
                <th className="px-4 py-3 font-medium">区分</th>
                <th className="px-4 py-3 font-medium">異動前</th>
                <th className="px-4 py-3 font-medium">異動後</th>
                <th className="px-4 py-3 font-medium">適用日</th>
                <th className="px-4 py-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3">
                    <Link href={`/transfers/${t.id}`} className="font-mono text-xs font-medium text-[#2563eb] hover:underline">
                      {t.transferNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#333333]">
                    {t.employeeName}
                    <div className="text-xs text-[#909090]">{t.employeeNo}</div>
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{TRANSFER_KIND_LABEL[t.kind]}</td>
                  <td className="px-4 py-3 text-[#707070]">{t.fromOrgUnitName ?? "—"}</td>
                  <td className="px-4 py-3 text-[#555555]">{t.toOrgUnitName ?? "—"}</td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(t.effectiveDate)}</td>
                  <td className="px-4 py-3">
                    <TransferStatusBadge status={t.status} />
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

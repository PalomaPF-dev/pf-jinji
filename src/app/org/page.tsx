import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { loadOrgChart } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import EmptyState from "@/components/EmptyState";
import OrgChart from "@/components/OrgChart";

export const dynamic = "force-dynamic";

/**
 * 組織図。基準日を指定すると、その日に有効だった組織で描画する
 * （有効期間を設定していない組織は常に含まれる）。
 */
export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requireJinjiSession();
  const { asOf } = await searchParams;
  const today = todayJST();
  const baseDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : today;

  const nodes = await loadOrgChart(baseDate);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="組織図"
        description={`${formatDate(baseDate)} 時点`}
        actions={
          <>
            <PrintButton label="組織図を印刷" />
            <Link
              href="/org/edit"
              className="no-print inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              <Settings2 className="h-4 w-4" />
              組織を編集
            </Link>
          </>
        }
      />

      <form method="get" className="no-print mb-6 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
        <div>
          <label htmlFor="asOf" className="mb-1 block text-xs font-medium text-[#707070]">
            基準日
          </label>
          <input
            id="asOf"
            name="asOf"
            type="date"
            defaultValue={baseDate}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          この日付で表示
        </button>
      </form>

      {nodes.length === 0 ? (
        <EmptyState
          title="組織が登録されていません"
          description="「組織を編集」からポータルの部署マスターを取り込むか、組織を追加してください。"
          action={
            <Link
              href="/org/edit"
              className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              組織を編集
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <OrgChart nodes={nodes} />
        </div>
      )}

      {/* 組織図はA4横1枚に収めることが多い */}
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } }`}</style>
    </div>
  );
}

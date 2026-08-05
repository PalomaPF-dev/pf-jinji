import Link from "next/link";
import { LayoutGrid, Settings2 } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { loadOrgChart } from "@/lib/org";
import type { OrgNode } from "@/lib/types";
import { todayJST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import EmptyState from "@/components/EmptyState";
import OrgChart from "@/components/OrgChart";
import OrgChartBoard from "@/components/OrgChartBoard";
import { buildOrgChart, sliceChart } from "@/lib/orgChart";

export const dynamic = "force-dynamic";

/**
 * 組織図。基準日を指定すると、その日に有効だった組織で描画する
 * （有効期間を設定していない組織は常に含まれる）。
 */
export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; view?: string }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const { asOf, view } = await searchParams;
  const today = todayJST();
  const baseDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : today;

  // 既定は実物の様式に合わせた配置表。ツリーは view=tree で見られる。
  const asBoard = view !== "tree";
  let [nodes, board] = await Promise.all([
    loadOrgChart(baseDate),
    asBoard ? buildOrgChart(baseDate) : Promise.resolve(null),
  ]);

  // 管理者は自分の工場だけを描画する
  if (scope.orgUnitIds !== null) {
    const findNode = (list: OrgNode[]): OrgNode | null => {
      for (const n of list) {
        if (n.id === scope.rootOrgId) return n;
        const f = findNode(n.children);
        if (f) return f;
      }
      return null;
    };
    const rootNode = findNode(nodes);
    nodes = rootNode ? [rootNode] : [];
    if (board) board = sliceChart(board, scope.rootOrgId);
  }

  return (
    <div className={`mx-auto px-4 py-8 ${asBoard ? "max-w-[1600px]" : "max-w-6xl"}`}>
      <PageHeader
        title={scope.scopeName ? `組織図（${scope.scopeName}）` : "組織図"}
        description={`${formatDate(baseDate)} 時点`}
        actions={
          <>
            <PrintButton label="組織図を印刷" />
            {scope.orgUnitIds === null && (
              <>
                <Link
                  href="/org/plan"
                  className="no-print inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
                >
                  <LayoutGrid className="h-4 w-4" />
                  異動案
                </Link>
                <Link
                  href="/org/edit"
                  className="no-print inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
                >
                  <Settings2 className="h-4 w-4" />
                  組織を編集
                </Link>
              </>
            )}
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
        <div>
          <label htmlFor="view" className="mb-1 block text-xs font-medium text-[#707070]">
            表示
          </label>
          <select
            id="view"
            name="view"
            defaultValue={asBoard ? "board" : "tree"}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="board">配置表（部署・氏名・役職・職務）</option>
            <option value="tree">ツリー</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          この条件で表示
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
      ) : asBoard && board ? (
        <section className="rounded-xl border border-[#e5e5e5] bg-white p-4">
          <OrgChartBoard chart={board} planId={null} editable={false} />
          <p className="no-print mt-3 text-xs text-[#909090]">
            配置を組み替えるには「異動案」を作ってください。組織図の上で人を動かせます。
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto">
          <OrgChart nodes={nodes} />
        </div>
      )}

      {/* 配置表は列が多いのでA3横、ツリーはA4横に収まることが多い */}
      <style>{`@media print { @page { size: ${asBoard ? "A3" : "A4"} landscape; margin: 8mm; } }`}</style>
    </div>
  );
}

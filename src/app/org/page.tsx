import Link from "next/link";
import { Hash, LayoutGrid, Pencil, Settings2 } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, loadOrgChart } from "@/lib/org";
import type { OrgNode } from "@/lib/types";
import { todayJST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import EmptyState from "@/components/EmptyState";
import OrgChart from "@/components/OrgChart";
import OrgChartBoard from "@/components/OrgChartBoard";
import { buildOrgChart, sliceChart, type ChartNode } from "@/lib/orgChart";

export const dynamic = "force-dynamic";

/**
 * 組織図。基準日を指定すると、その日に有効だった組織で描画する
 * （有効期間を設定していない組織は常に含まれる）。
 */
export default async function OrgPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; view?: string; dept?: string; wp?: string; edit?: string }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const { asOf, view, dept = "", wp = "", edit } = await searchParams;
  // 組織図を見ながら名称・コード・階層を直すモード
  const orgEdit = edit === "1";
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

  // 部署名・職場名の絞り込み（配置表のみ）。選択肢は絞る前の表から作る。
  // 部署 ＝ 本部直下（工場・部・EHS統括室など）、職場 ＝ その配下すべて。
  const deptNodes: ChartNode[] = board
    ? scope.orgUnitIds === null
      ? board.roots.flatMap((r) => r.children)
      : board.roots
    : [];
  const workplaceGroups = deptNodes.map((d) => {
    const items: { id: string; name: string }[] = [];
    const walk = (n: ChartNode) => {
      items.push({ id: n.orgUnitId, name: n.orgUnitName });
      n.children.forEach(walk);
    };
    d.children.forEach(walk);
    return { dept: d, items };
  });
  if (board && wp) board = sliceChart(board, wp);
  else if (board && dept) board = sliceChart(board, dept);

  // 上位組織の選択肢。編集モードのときだけ作る（普段は要らない）
  const moveOptions = orgEdit
    ? flattenTree(buildOrgTree(activeOn(await listOrgUnits(), baseDate), new Map(), new Map()))
        .filter((o) => scope.orgUnitIds === null || scope.orgUnitIds.includes(o.id))
        .map((o) => ({ id: o.id, label: o.label, depth: o.depth }))
    : [];

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
                  href="/org/codes"
                  className="no-print inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
                >
                  <Hash className="h-4 w-4" />
                  部署・職場の設定
                </Link>
                {asBoard && (
                  <Link
                    href={`/org?${new URLSearchParams({
                      ...(asOf ? { asOf } : {}),
                      ...(dept ? { dept } : {}),
                      ...(wp ? { wp } : {}),
                      ...(orgEdit ? {} : { edit: "1" }),
                    })}`}
                    className={`no-print inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
                      orgEdit
                        ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                        : "border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]"
                    }`}
                  >
                    <Pencil className="h-4 w-4" />
                    {orgEdit ? "編集モードを終える" : "この画面で編集"}
                  </Link>
                )}
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
          <label htmlFor="dept" className="mb-1 block text-xs font-medium text-[#707070]">
            部署名
          </label>
          <select
            id="dept"
            name="dept"
            defaultValue={dept}
            className="max-w-[220px] rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="">すべての部署</option>
            {deptNodes.map((d) => (
              <option key={d.orgUnitId} value={d.orgUnitId}>
                {d.orgUnitName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="wp" className="mb-1 block text-xs font-medium text-[#707070]">
            職場名
          </label>
          <select
            id="wp"
            name="wp"
            defaultValue={wp}
            className="max-w-[260px] rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="">すべての職場</option>
            {workplaceGroups
              .filter((g) => !dept || g.dept.orgUnitId === dept)
              .map((g) => (
                <optgroup key={g.dept.orgUnitId} label={g.dept.orgUnitName}>
                  {g.items.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
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
          <>
          {orgEdit && (
            <p className="no-print mb-3 rounded-lg border border-[#c8d8f5] bg-[#eff6ff] px-3 py-2 text-xs text-[#1d4ed8]">
              枠の見出しの「編集」を押すと、その場で<strong>組織名・部署コード・職場コード・上位組織</strong>を直せます。
              誰がぶら下がっているかを見ながら直せます。上位組織を変えると、配下もそのまま一緒に移ります。
              変更は次の「設定 → ポータルへ連携」でポータルにも反映されます。
            </p>
          )}
          <OrgChartBoard
            chart={board}
            planId={null}
            editable={false}
            orgEdit={orgEdit}
            moveOptions={moveOptions}
          />
          </>
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

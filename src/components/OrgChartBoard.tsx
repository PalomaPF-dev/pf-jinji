"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { movePersonAction } from "@/app/org/plan/actions";
import type { ChartNode, ChartPerson, OrgChartData } from "@/lib/orgChart";

/**
 * 配置表（組織図）。階層ごとに列を分け、**親の枠が子の枠ぶんの高さを取る**
 * 1枚の表として描く。列を独立に積むと親子の位置がずれて関係が読めないため、
 * rowSpan で親と子を必ず横に揃える。
 *
 * 工場長・工場長代理は親の工場の枠に統合されて出る（lib/orgChart.ts）。
 *
 * 異動案を開いているときは、人をドラッグして別の枠へ落とせる。
 * 落とした時点では人事マスターに書かず、案に記録するだけ（確定時に異動申請書を起こす）。
 */

/** 凡例。実物と同じ記号・語を使う。 */
const LEGEND: { sign: string; label: string; mark: string }[] = [
  { sign: "◎", label: "昇格（職務・役職）", mark: "promo_both" },
  { sign: "○", label: "昇格（職務）", mark: "promo_duty" },
  { sign: "△", label: "所属移動", mark: "move" },
];

const SIGN: Record<string, string> = {
  promo_both: "◎",
  promo_duty: "○",
  move: "△",
};

interface Cell {
  node: ChartNode;
  row: number;
}

export default function OrgChartBoard({
  chart,
  planId,
  editable,
}: {
  chart: OrgChartData;
  planId: string | null;
  editable: boolean;
}) {
  const [dragging, setDragging] = useState<ChartPerson | null>(null);
  const [hoverOrg, setHoverOrg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canDrag = editable && Boolean(planId);

  // 木 → 表のマス目。各枠の開始行を DFS で決める（親の枠は子の行ぶん rowSpan）
  const { byRow, totalRows, minDepth, cols } = useMemo(() => {
    const cells: Cell[] = [];
    let cursor = 0;
    const walk = (n: ChartNode, row: number) => {
      cells.push({ node: n, row });
      let r = row;
      for (const c of n.children) {
        walk(c, r);
        r += c.span;
      }
    };
    for (const rt of chart.roots) {
      walk(rt, cursor);
      cursor += rt.span;
    }
    const minDepth = chart.roots.length ? Math.min(...chart.roots.map((r) => r.depth)) : 0;
    const byRow = new Map<number, Cell[]>();
    for (const c of cells) {
      const list = byRow.get(c.row) ?? [];
      list.push(c);
      byRow.set(c.row, list);
    }
    for (const list of byRow.values()) list.sort((a, b) => a.node.depth - b.node.depth);
    return { byRow, totalRows: cursor, minDepth, cols: chart.maxDepth - minDepth + 1 };
  }, [chart]);

  const drop = (orgUnitId: string) => {
    if (!canDrag || !dragging) return;
    const person = dragging;
    setDragging(null);
    setHoverOrg(null);
    if (person.orgUnitId === orgUnitId) return;

    startTransition(async () => {
      const form = new FormData();
      form.set("planId", planId!);
      form.set("employeeId", person.employeeId);
      form.set("toOrgUnitId", orgUnitId);
      const r = await movePersonAction({}, form);
      setNotice(r.error ?? r.message ?? null);
    });
  };

  return (
    <div>
      {/* 凡例 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#555555]">
        {LEGEND.map((l) => (
          <span key={l.mark} className="inline-flex items-center gap-1">
            <span className="w-4 text-center text-sm">{l.sign}</span>
            {l.label}
          </span>
        ))}
        {canDrag && (
          <span className="ml-auto text-[#909090]">
            氏名をつかんで、移したい部署の枠へ落としてください。
          </span>
        )}
      </div>

      {notice && (
        <p className="no-print mb-3 rounded-lg bg-[#eff6ff] px-3 py-2 text-sm text-[#1d4ed8]">
          {notice}
          {pending && "…"}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-max border-collapse text-[11px]">
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, i) => (
                <th
                  key={i}
                  className="border border-[#333] bg-[#f2f2f2] px-2 py-1 text-left text-[10px] font-medium text-[#555]"
                  style={{ minWidth: "300px" }}
                >
                  第{minDepth + i + 1}階層
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRows }, (_, row) => (
              <tr key={row}>
                {(byRow.get(row) ?? []).map(({ node }) => {
                  const col = node.depth - minDepth;
                  return (
                    <td
                      key={node.orgUnitId}
                      rowSpan={node.span}
                      colSpan={node.children.length === 0 ? cols - col : 1}
                      onDragOver={(e) => {
                        if (!canDrag) return;
                        e.preventDefault();
                        setHoverOrg(node.orgUnitId);
                      }}
                      onDragLeave={() => setHoverOrg((v) => (v === node.orgUnitId ? null : v))}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop(node.orgUnitId);
                      }}
                      className={`border border-[#333] p-0 align-top ${
                        hoverOrg === node.orgUnitId ? "bg-[#eff6ff] outline outline-2 outline-[#2563eb]" : "bg-white"
                      }`}
                    >
                      <div className="border-b border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.5 text-[11px] font-bold text-[#333]">
                        {node.orgUnitName}
                        {node.people.length > 0 && (
                          <span className="ml-1 font-normal text-[#909090]">{node.people.length}名</span>
                        )}
                      </div>
                      {node.people.length === 0 ? (
                        <p className="px-1.5 py-1 text-[10px] text-[#c0c0c0]">所属者なし</p>
                      ) : (
                        <table className="w-full border-collapse">
                          <tbody>
                            {node.people.map((p) => (
                              <tr
                                key={p.employeeId}
                                draggable={canDrag}
                                onDragStart={() => setDragging(p)}
                                onDragEnd={() => setDragging(null)}
                                className={`${p.mark ? "bg-[#eaf3e8]" : ""} ${
                                  canDrag ? "cursor-grab" : ""
                                } border-b border-[#f0f0f0] last:border-0`}
                              >
                                <td className="w-5 px-1 py-0.5 text-center text-[#333]">
                                  {p.mark ? SIGN[p.mark] : ""}
                                </td>
                                <td className="w-[9em] border-r border-[#f0f0f0] px-1 py-0.5">
                                  <Link
                                    href={`/employees/${p.employeeId}`}
                                    className="text-[#333] hover:text-[#2563eb] hover:underline"
                                  >
                                    {p.name}
                                  </Link>
                                </td>
                                <td className="w-[8em] border-r border-[#f0f0f0] px-1 py-0.5 text-[#555]">
                                  {p.positionName ?? ""}
                                </td>
                                <td className="px-1 py-0.5 text-[#555]">{p.dutyName ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chart.unassigned.length > 0 && (
        <div
          onDragOver={(e) => canDrag && e.preventDefault()}
          className="mt-4 rounded-lg border border-dashed border-[#e5e5e5] bg-[#fafafa] p-3"
        >
          <p className="mb-1 text-xs font-medium text-[#555555]">
            所属が未設定（{chart.unassigned.length} 名）
          </p>
          <p className="text-[11px] text-[#909090]">
            {chart.unassigned.slice(0, 30).map((p) => p.name).join("、")}
            {chart.unassigned.length > 30 && ` ほか ${chart.unassigned.length - 30} 名`}
          </p>
        </div>
      )}
    </div>
  );
}

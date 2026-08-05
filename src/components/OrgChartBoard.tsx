"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { movePersonAction } from "@/app/org/plan/actions";
import type { ChartColumn, ChartPerson } from "@/lib/orgChart";

/**
 * 配置表（組織図）。実物の様式に合わせ、**階層ごとに列を分けて**
 * 部署／氏名／役職／職務 を並べる。人は自分の所属組織の深さの列に出る。
 *
 * 異動案を開いているときは、人をドラッグして別の組織へ落とせる。
 * 落とした時点では人事マスターに書かず、案に記録するだけ（確定時に異動申請書を起こす）。
 * 直接書き換えないのは、所属の変更を申請書の履歴として残すため。
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

export default function OrgChartBoard({
  columns,
  unassigned,
  planId,
  editable,
}: {
  columns: ChartColumn[];
  unassigned: ChartPerson[];
  planId: string | null;
  editable: boolean;
}) {
  const [dragging, setDragging] = useState<ChartPerson | null>(null);
  const [hoverOrg, setHoverOrg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canDrag = editable && Boolean(planId);

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
            氏名をつかんで、移したい部署へ落としてください。
          </span>
        )}
      </div>

      {notice && (
        <p className="no-print mb-3 rounded-lg bg-[#eff6ff] px-3 py-2 text-sm text-[#1d4ed8]">
          {notice}
          {pending && "…"}
        </p>
      )}

      {/* 階層ごとの列 */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-start gap-3">
          {columns.map((col) => (
            <div key={col.depth} className="w-[420px] shrink-0">
              <div className="mb-1 text-[10px] text-[#909090]">第{col.depth + 1}階層</div>
              <div className="space-y-2">
                {col.groups.map((g) => (
                  <div
                    key={g.orgUnitId}
                    onDragOver={(e) => {
                      if (!canDrag) return;
                      e.preventDefault();
                      setHoverOrg(g.orgUnitId);
                    }}
                    onDragLeave={() => setHoverOrg((v) => (v === g.orgUnitId ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      drop(g.orgUnitId);
                    }}
                    className={`rounded border ${
                      hoverOrg === g.orgUnitId
                        ? "border-[#2563eb] bg-[#eff6ff]"
                        : "border-[#333] bg-white"
                    }`}
                  >
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-[#f2f2f2] text-left text-[10px] text-[#555]">
                          <th className="w-8 border-b border-[#333] px-1 py-0.5 font-normal"> </th>
                          <th className="border-b border-r border-[#333] px-1 py-0.5 font-normal">部署</th>
                          <th className="border-b border-r border-[#333] px-1 py-0.5 font-normal">氏名</th>
                          <th className="border-b border-r border-[#333] px-1 py-0.5 font-normal">役職</th>
                          <th className="border-b border-[#333] px-1 py-0.5 font-normal">職務</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.people.length === 0 ? (
                          <tr>
                            <td className="px-1 py-1 text-[10px] text-[#909090]" colSpan={5}>
                              {g.orgUnitName}（所属者なし）
                            </td>
                          </tr>
                        ) : (
                          g.people.map((p) => (
                            <tr
                              key={p.employeeId}
                              draggable={canDrag}
                              onDragStart={() => setDragging(p)}
                              onDragEnd={() => setDragging(null)}
                              className={`${p.mark ? "bg-[#eaf3e8]" : ""} ${
                                canDrag ? "cursor-grab" : ""
                              } border-b border-[#e5e5e5] last:border-0`}
                            >
                              <td className="px-1 py-0.5 text-center text-[#333]">
                                {p.mark ? SIGN[p.mark] : ""}
                              </td>
                              <td className="border-r border-[#e5e5e5] px-1 py-0.5 text-[#555]">
                                {g.orgUnitName}
                              </td>
                              <td className="border-r border-[#e5e5e5] px-1 py-0.5">
                                <Link
                                  href={`/employees/${p.employeeId}`}
                                  className="text-[#333] hover:text-[#2563eb] hover:underline"
                                >
                                  {p.name}
                                </Link>
                              </td>
                              <td className="border-r border-[#e5e5e5] px-1 py-0.5 text-[#555]">
                                {p.positionName ?? ""}
                              </td>
                              <td className="px-1 py-0.5 text-[#555]">{p.dutyName ?? ""}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {unassigned.length > 0 && (
        <div
          onDragOver={(e) => canDrag && e.preventDefault()}
          className="mt-4 rounded-lg border border-dashed border-[#e5e5e5] bg-[#fafafa] p-3"
        >
          <p className="mb-1 text-xs font-medium text-[#555555]">所属が未設定（{unassigned.length} 名）</p>
          <p className="text-[11px] text-[#909090]">
            {unassigned.slice(0, 30).map((p) => p.name).join("、")}
            {unassigned.length > 30 && ` ほか ${unassigned.length - 30} 名`}
          </p>
        </div>
      )}
    </div>
  );
}

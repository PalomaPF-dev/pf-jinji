"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { movePersonAction } from "@/app/org/plan/actions";
import {
  createOrgUnitAction,
  deleteOrgUnitAction,
  updateOrgCodesAction,
  type OrgActionState,
} from "@/app/org/actions";
import { ORG_KIND_LABEL, ORG_KIND_ORDER } from "@/lib/types";

/** 階層を変えるときの移動先の候補（本部・部署・職場のすべて）。 */
import type { ChartNode, ChartPerson, OrgChartData } from "@/lib/orgChart";

/** 階層を変えるときの移動先の候補（本部・部署・職場のすべて）。 */
export interface OrgMoveOption {
  id: string;
  label: string;
  depth: number;
}

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
  orgEdit = false,
  moveOptions = [],
}: {
  chart: OrgChartData;
  planId: string | null;
  editable: boolean;
  /** 組織そのもの（名称・コード・階層）を直せるか */
  orgEdit?: boolean;
  moveOptions?: OrgMoveOption[];
}) {
  const [dragging, setDragging] = useState<ChartPerson | null>(null);
  const [hoverOrg, setHoverOrg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 組織の編集は1つずつ開く。上位組織の選択肢を全枠ぶん描くと、
  // 200枠 × 200候補で HTML が数MBになるため（社員台帳で同じ轍を踏んでいる）
  const [editingOrg, setEditingOrg] = useState<string | null>(null);

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
                      data-org={node.orgUnitId}
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
                      <OrgCellHeader
                        node={node}
                        orgEdit={orgEdit}
                        moveOptions={moveOptions}
                        editing={editingOrg === node.orgUnitId}
                        onEdit={() => setEditingOrg(node.orgUnitId)}
                        onClose={() => setEditingOrg(null)}
                      />
                      {node.hidden && (
                        <p className="border-b border-[#f0f0f0] bg-[#fbfbfb] px-1.5 py-0.5 text-[10px] text-[#909090]">
                          配下 {node.hidden.units}組織 {node.hidden.people}名（階層の絞り込みで省略）
                        </p>
                      )}
                      {node.people.length === 0 ? (
                        <p className="px-1.5 py-1 text-[10px] text-[#c0c0c0]">
                          {node.hidden ? "" : "所属者なし"}
                        </p>
                      ) : (
                        <table className="w-full border-collapse">
                          <tbody>
                            {node.people.map((p) => (
                              <tr
                                key={p.employeeId}
                                draggable={canDrag && !p.concurrent}
                                onDragStart={() => setDragging(p)}
                                onDragEnd={() => setDragging(null)}
                                className={`${p.mark ? "bg-[#eaf3e8]" : ""} ${
                                  p.concurrent ? "bg-[#fbfbfb] text-[#707070]" : ""
                                } ${canDrag ? "cursor-grab" : ""} border-b border-[#f0f0f0] last:border-0`}
                              >
                                <td
                                  className="w-5 px-1 py-0.5 text-center text-[#333]"
                                  title={p.concurrent ? "兼務（本務は別の組織）" : undefined}
                                >
                                  {p.concurrent ? "兼" : p.mark ? SIGN[p.mark] : ""}
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


/**
 * 枠の見出し。組織名と、人事システムのコードを出す。
 *
 * 編集モードでは、この見出しがそのまま入力欄になる。誰がぶら下がっているかを
 * 見ながら直せるようにするため、別画面へ飛ばさずここで完結させている。
 * 上位組織の選択肢は**開いている1枠ぶんだけ**描く（全枠に持たせると HTML が膨らむ）。
 */
function OrgCellHeader({
  node,
  orgEdit,
  moveOptions,
  editing,
  onEdit,
  onClose,
}: {
  node: ChartNode;
  orgEdit: boolean;
  moveOptions: OrgMoveOption[];
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(updateOrgCodesAction, {} as OrgActionState);
  const [createState, createAction] = useActionState(createOrgUnitAction, {} as OrgActionState);
  const [adding, setAdding] = useState(false);
  const codes = [node.deptCode, node.workplaceCode].filter(Boolean).join(" / ");

  if (orgEdit && editing) {
    return (
      <div className="border-b border-[#2563eb] bg-[#eff6ff] p-1.5 text-[11px]">
      <form action={formAction}>
        <input type="hidden" name="id" value={node.orgUnitId} />
        <input
          name="name"
          required
          defaultValue={node.orgUnitName}
          aria-label="組織名"
          className="mb-1 w-full rounded border border-[#c8d8f5] bg-white px-1 py-0.5 text-[11px] font-bold outline-none focus:border-[#2563eb]"
        />
        <div className="mb-1 flex gap-1">
          <input
            name="deptCode"
            defaultValue={node.deptCode ?? ""}
            placeholder="部署コード"
            aria-label="部署コード"
            className="w-1/2 rounded border border-[#c8d8f5] bg-white px-1 py-0.5 font-mono text-[10px] outline-none focus:border-[#2563eb]"
          />
          <input
            name="workplaceCode"
            defaultValue={node.workplaceCode ?? ""}
            placeholder="職場コード"
            aria-label="職場コード"
            className="w-1/2 rounded border border-[#c8d8f5] bg-white px-1 py-0.5 font-mono text-[10px] outline-none focus:border-[#2563eb]"
          />
        </div>
        <select
          name="parentId"
          defaultValue={node.parentId ?? ""}
          aria-label="上位組織"
          className="mb-1 w-full rounded border border-[#c8d8f5] bg-white px-1 py-0.5 text-[10px] outline-none focus:border-[#2563eb]"
        >
          <option value="">（最上位）</option>
          {moveOptions
            .filter((o) => o.id !== node.orgUnitId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {"　".repeat(o.depth)}
                {o.label}
              </option>
            ))}
        </select>
        <div className="mb-1 flex gap-1">
          <select
            name="kind"
            defaultValue={node.kind}
            aria-label="区分"
            className="w-1/2 rounded border border-[#c8d8f5] bg-white px-1 py-0.5 text-[10px] outline-none focus:border-[#2563eb]"
          >
            {ORG_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {ORG_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {/* 組織の長はこの枠に居る人から選ぶ（全社員を並べると重くなるうえ、実務でも枠の中の人） */}
          <select
            name="headEmployeeId"
            defaultValue={node.headEmployeeId ?? ""}
            aria-label="組織の長"
            className="w-1/2 rounded border border-[#c8d8f5] bg-white px-1 py-0.5 text-[10px] outline-none focus:border-[#2563eb]"
          >
            <option value="">長は未設定</option>
            {node.people.map((p) => (
              <option key={p.employeeId} value={p.employeeId}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded bg-[#2563eb] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#1d4ed8]"
          >
            保存
          </button>
          <button type="button" onClick={onClose} className="text-[10px] text-[#707070] hover:underline">
            やめる
          </button>
          {state.error && <span className="text-[10px] text-[#b91c1c]">{state.error}</span>}
          {state.message && <span className="text-[10px] text-[#1c7a4d]">保存しました</span>}
        </div>
      </form>

      {/* 配下に組織を足す・この組織を消す */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-[#c8d8f5] pt-1.5">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] text-[#2563eb] hover:underline"
        >
          {adding ? "追加をやめる" : "＋ 配下に追加"}
        </button>
        <OrgDeleteInline
          id={node.orgUnitId}
          name={node.orgUnitName}
          childCount={node.children.length}
        />
      </div>

      {adding && (
        <form action={createAction} className="mt-1.5 rounded border border-[#c8d8f5] bg-white p-1.5">
          <input type="hidden" name="parentId" value={node.orgUnitId} />
          {/* 区分は親の位置から決める。本部の直下なら部、その下なら課 */}
          <input type="hidden" name="kind" value={node.depth === 0 ? "bu" : "ka"} />
          <input
            name="name"
            required
            placeholder="新しい組織の名称"
            aria-label="新しい組織の名称"
            className="mb-1 w-full rounded border border-[#e5e5e5] px-1 py-0.5 text-[11px] outline-none focus:border-[#2563eb]"
          />
          <div className="mb-1 flex gap-1">
            <input
              name="deptCode"
              defaultValue={node.deptCode ?? ""}
              placeholder="部署コード"
              aria-label="新しい組織の部署コード"
              className="w-1/2 rounded border border-[#e5e5e5] px-1 py-0.5 font-mono text-[10px] outline-none focus:border-[#2563eb]"
            />
            <input
              name="workplaceCode"
              placeholder="職場コード"
              aria-label="新しい組織の職場コード"
              className="w-1/2 rounded border border-[#e5e5e5] px-1 py-0.5 font-mono text-[10px] outline-none focus:border-[#2563eb]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded bg-[#2563eb] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#1d4ed8]"
            >
              追加
            </button>
            {createState.error && <span className="text-[10px] text-[#b91c1c]">{createState.error}</span>}
            {createState.message && <span className="text-[10px] text-[#1c7a4d]">追加しました</span>}
          </div>
        </form>
      )}
      </div>
    );
  }

  // 人数は本務だけを数える。兼務は「兼◯」として別に添える（二重に数えないため）
  const home = node.people.filter((p) => !p.concurrent).length;
  const kenmu = node.people.length - home;

  return (
    <div className="border-b border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.5 text-[11px] font-bold text-[#333]">
      {node.orgUnitName}
      {home > 0 && <span className="ml-1 font-normal text-[#909090]">{home}名</span>}
      {kenmu > 0 && <span className="ml-1 font-normal text-[#909090]">兼{kenmu}</span>}
      {codes && <span className="ml-1 font-mono text-[10px] font-normal text-[#909090]">{codes}</span>}
      {orgEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="no-print ml-1 font-normal text-[10px] text-[#2563eb] hover:underline"
        >
          編集
        </button>
      )}
    </div>
  );
}


/**
 * 枠の中からの削除。所属者がいれば拒否される。
 * 配下があるときは1つ上へ引き上げてから消す（配下が黙って最上位に浮かないように）。
 */
function OrgDeleteInline({
  id,
  name,
  childCount,
}: {
  id: string;
  name: string;
  childCount: number;
}) {
  const [state, formAction] = useActionState(deleteOrgUnitAction, {} as OrgActionState);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="moveChildren" value="1" />
      <button
        type="submit"
        onClick={(e) => {
          const msg =
            childCount > 0
              ? `「${name}」を削除し、配下の ${childCount} 件を1つ上の組織へ移します。よろしいですか？`
              : `「${name}」を削除します。よろしいですか？`;
          if (!window.confirm(msg)) e.preventDefault();
        }}
        className="text-[10px] text-[#b91c1c] hover:underline"
      >
        この組織を削除
      </button>
      {state.error && <span className="text-[10px] text-[#b91c1c]">{state.error}</span>}
    </form>
  );
}

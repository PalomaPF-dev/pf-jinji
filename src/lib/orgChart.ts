import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { activeOn, buildOrgTree, listOrgUnits } from "./org";
import type { OrgPlanMove } from "./orgPlans";

/**
 * 組織図（配置表）の描画データ。
 *
 * 実物の様式は「階層ごとに列を分け、各列に 部署／氏名／役職／職務 を並べる」もの。
 * 人は**自分の所属組織の深さ**の列に置かれる（本部直属は左端、末端の職場は右端）。
 * そのため木構造そのものではなく、深さで束ねた列として返す。
 */

export interface ChartPerson {
  employeeId: string;
  employeeNo: string;
  name: string;
  orgUnitId: string;
  orgUnitName: string;
  positionName: string | null;
  dutyName: string | null;
  /** 異動案でこの人に付いた印（案を開いていないときは null） */
  mark: string | null;
  /** 案での異動先。元の位置に薄く残して「どこへ行くか」を見せるために使う */
  movingToOrgUnitId: string | null;
  movingToOrgUnitName: string | null;
  /** 案によってこの列に来ている（元は別の組織） */
  incoming: boolean;
}

export interface ChartGroup {
  orgUnitId: string;
  orgUnitName: string;
  /** ルートからの深さ（0 が最上位） */
  depth: number;
  people: ChartPerson[];
}

export interface ChartColumn {
  depth: number;
  groups: ChartGroup[];
}

/**
 * 配置表を組み立てる。
 *
 * plan が渡されたときは、その案を反映した「案の姿」を返す。
 * 動かした人は異動先のグループへ移し、印を付ける。
 */
export async function buildOrgChart(
  asOf: string,
  moves: OrgPlanMove[] = [],
): Promise<{ columns: ChartColumn[]; unassigned: ChartPerson[] }> {
  await ensureSchema();
  const sql = getSql();

  const units = activeOn(await listOrgUnits(), asOf);
  // 深さは木を組んでから求める（親を辿るより木の方が確実）
  const tree = buildOrgTree(units, new Map(), new Map());
  const depthById = new Map<string, number>();
  const nameById = new Map<string, string>();
  const sortById = new Map<string, number>();
  let order = 0;
  const walk = (nodes: typeof tree) => {
    for (const n of nodes) {
      depthById.set(n.id, n.depth);
      nameById.set(n.id, n.name);
      sortById.set(n.id, order++);
      walk(n.children);
    }
  };
  walk(tree);

  const rows = await sql`
    SELECT e.id, e.employee_no, e.name, e.org_unit_id, e.position_name, e.duty_name
    FROM jinji_employees e
    WHERE e.status <> 'retired'
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;

  const moveByEmployee = new Map(moves.map((m) => [m.employeeId, m]));

  const groups = new Map<string, ChartGroup>();
  const unassigned: ChartPerson[] = [];

  for (const r of rows) {
    const employeeId = r.id as string;
    const move = moveByEmployee.get(employeeId);
    const originalOrgId = (r.org_unit_id as string | null) ?? null;
    // 案があればそちらの所属で並べる（案の姿を見せるため）
    const orgUnitId = move ? move.toOrgUnitId ?? originalOrgId : originalOrgId;

    const person: ChartPerson = {
      employeeId,
      employeeNo: r.employee_no as string,
      name: r.name as string,
      orgUnitId: orgUnitId ?? "",
      orgUnitName: orgUnitId ? nameById.get(orgUnitId) ?? "" : "",
      // 案で役職・職務も変える場合は、案の値を優先して見せる
      positionName: (move?.toPosition ?? (r.position_name as string | null)) ?? null,
      dutyName: (move?.toDuty ?? (r.duty_name as string | null)) ?? null,
      mark: move?.mark ?? null,
      movingToOrgUnitId: move?.toOrgUnitId ?? null,
      movingToOrgUnitName: move?.toOrgUnitName ?? null,
      incoming: Boolean(move && move.toOrgUnitId && move.toOrgUnitId !== originalOrgId),
    };

    if (!orgUnitId || !depthById.has(orgUnitId)) {
      unassigned.push(person);
      continue;
    }
    let g = groups.get(orgUnitId);
    if (!g) {
      g = {
        orgUnitId,
        orgUnitName: nameById.get(orgUnitId) ?? "",
        depth: depthById.get(orgUnitId) ?? 0,
        people: [],
      };
      groups.set(orgUnitId, g);
    }
    g.people.push(person);
  }

  // 人が居ない組織も列に出す（異動の受け皿になるので、空でも見えている必要がある）
  for (const [id, depth] of depthById) {
    if (!groups.has(id)) {
      groups.set(id, { orgUnitId: id, orgUnitName: nameById.get(id) ?? "", depth, people: [] });
    }
  }

  const byDepth = new Map<number, ChartGroup[]>();
  for (const g of [...groups.values()].sort(
    (a, b) => (sortById.get(a.orgUnitId) ?? 0) - (sortById.get(b.orgUnitId) ?? 0),
  )) {
    const list = byDepth.get(g.depth) ?? [];
    list.push(g);
    byDepth.set(g.depth, list);
  }

  const columns: ChartColumn[] = [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, groups]) => ({ depth, groups }));

  return { columns, unassigned };
}

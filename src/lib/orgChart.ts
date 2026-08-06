import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { activeOn, buildOrgTree, listOrgUnits } from "./org";
import { normalizeOrgName } from "./hrMasterImport";
import type { OrgKind, OrgNode } from "./types";
import type { OrgPlanMove } from "./orgPlans";
import { listConcurrentMembers } from "./concurrentPosts";

/**
 * 組織図（配置表）の描画データ。
 *
 * 実物の様式は「階層ごとに列を分け、親の枠が子の枠ぶんの高さを取る」表。
 * 列を独立に積むと親子の位置がずれて関係が読めないため、
 * **木構造のまま**返し、表側で rowSpan を使って親子を揃える。
 *
 * 工場長・工場長代理のような「親組織の長」の組織は、親（工場・部）の枠へ
 * 統合して一緒に見せる（実物の組織図でも工場の枠の中に工場長が居るため）。
 */

export interface ChartPerson {
  employeeId: string;
  employeeNo: string;
  name: string;
  /** 実際の所属組織（統合表示でも本来の所属を保持する） */
  orgUnitId: string;
  orgUnitName: string;
  positionName: string | null;
  dutyName: string | null;
  /** 異動案でこの人に付いた印（案を開いていないときは null） */
  mark: string | null;
  /** 案での異動先 */
  movingToOrgUnitId: string | null;
  movingToOrgUnitName: string | null;
  /** 案によってこの枠に来ている（元は別の組織） */
  incoming: boolean;
  /** 兼務でこの枠に出ている（本務は別の組織）。人数には数えない */
  concurrent?: boolean;
}

export interface ChartNode {
  /** この枠の組織（ドラッグの落とし先になる） */
  orgUnitId: string;
  orgUnitName: string;
  /** 根からの深さ（0 が本部） */
  depth: number;
  /** この枠に出す人（統合した長の組織の人を含む） */
  people: ChartPerson[];
  children: ChartNode[];
  /** 表で占める行数（子の行数の合計。葉は1） */
  span: number;
  /** 並び替えに使うコード（部署コード → 職場コード → 数字の組織コード の順で採る） */
  sortCode: string | null;
  /** 人事マスタの部署コード（画面に出す・組織図から直せるように） */
  deptCode: string | null;
  /** 人事マスタの職場コード（同上） */
  workplaceCode: string | null;
  /** 上位組織。組織図から階層を直すときの現在値 */
  parentId: string | null;
  /** 区分（部・課・工場…）。組織図から直せるように */
  kind: OrgKind;
  /** 組織の長（jinji_employees.id） */
  headEmployeeId: string | null;
  /** 階層の絞り込みで畳んだ配下（この枠より深い組織数・人数の合計） */
  hidden?: { units: number; people: number };
}

export interface OrgChartData {
  roots: ChartNode[];
  /** 最深の depth（列数の決定に使う） */
  maxDepth: number;
  unassigned: ChartPerson[];
}

/**
 * 役職・職務の序列。組織図の枠の中では上位の人から並べる。
 * 名称は「工場長A」「課長心得」のように接尾辞が付くため、部分一致で判定する。
 * どれにも当てはまらないもの（一般・その他・空欄）は末尾。
 */
// 「工場長」より「工場長代理」を先に検査する必要があるが、序列は 長 > 代理。
// 検査順（配列の並び）と序列（rank）を分けて持つ。
// 番号は間を空けてある（役職と職務の両方をこの表で測るため、後から挟めるように）。
const POSITION_RANKS: { re: RegExp; rank: number }[] = [
  { re: /常務取締役/, rank: 0 },
  { re: /取締役/, rank: 1 },
  // 「副本部長」は「本部長」を含むので、先に検査する
  { re: /副本部長/, rank: 3 },
  { re: /本部長|部門長/, rank: 2 },
  { re: /副工場長/, rank: 12 },
  { re: /工場長代理/, rank: 13 },
  { re: /工場長付/, rank: 14 },
  { re: /工場長/, rank: 10 },
  { re: /部長代理/, rank: 21 },
  { re: /部長/, rank: 20 },
  { re: /次長/, rank: 25 },
  { re: /センター長|ｾﾝﾀｰ長/, rank: 30 },
  { re: /室長/, rank: 35 },
  { re: /課長代理/, rank: 41 },
  { re: /課長心得/, rank: 42 },
  { re: /課長/, rank: 40 },
  { re: /マネージャー|ﾏﾈｰｼﾞｬｰ/, rank: 45 },
  { re: /グループ長|ｸﾞﾙｰﾌﾟ長/, rank: 50 },
  { re: /係長心得/, rank: 56 },
  { re: /係長/, rank: 55 },
  { re: /班長/, rank: 60 },
  { re: /主任代理/, rank: 66 },
  { re: /主任/, rank: 65 },
];

/** 役職の序列（小さいほど上位）。該当なしは末尾。 */
export function positionRank(positionName: string | null): number {
  const p = (positionName ?? "").trim();
  if (!p) return 99;
  for (const { re, rank } of POSITION_RANKS) {
    if (re.test(p)) return rank;
  }
  return 99;
}

/**
 * 職務の序列（小さいほど上位）。役職より先に効く。
 *
 * 職場を実際に率いているのは職務の「グループ長」「室長」「工場長」であって、
 * 役職（一般・主任・係長…）ではない。そのため枠の先頭は職務で決める。
 *
 * ただし職務欄には「安全推進工場長室」（所属を表すだけ）「品質管理推進責任者」
 * 「温水多工程3級」のような**役職名でないもの**も入る。長で終わる肩書き
 * （＋マネージャー）だけを役職とみなし、それ以外は末尾に置く。
 */
// 「取締役」は長で終わらないが役職名。入れておかないと 99（末尾）に落ちて、
// 職務が「常務取締役」の人が「部門長」の人より下に並んでしまう。
const DUTY_TITLE_RE = /(長|長代理|長心得|長付|取締役|マネージャー|ﾏﾈｰｼﾞｬｰ)$/;

export function dutyRank(dutyName: string | null): number {
  let d = (dutyName ?? "").trim();
  if (!d) return 99;
  d = d.replace(/[（(][^）)]*[）)]$/, "").trim(); // 「グループ長（工場）」→「グループ長」
  d = d.replace(/[ 　]*[A-ZＡ-Ｚ]$/, "").trim(); // 「工場長A」→「工場長」
  if (!DUTY_TITLE_RE.test(d)) return 99;
  return positionRank(d);
}

/** 工場か（並びで部の後ろに置く）。「大口可児工場」のような配下の工場も含む。 */
export function isFactoryOrg(name: string): boolean {
  return /工場$/.test(name.replace(/[\s　]+/g, ""));
}

/** 親の枠へ統合する組織か（「大口工場長」「大口工場長代理」「同名の部」など）。 */
export function mergesIntoParent(parentName: string, childName: string): boolean {
  const p = normalizeOrgName(parentName);
  const c = normalizeOrgName(childName);
  if (!p || !c) return false;
  if (c === p) return true;
  return c.startsWith(p) && /^長(代理|付)?$/.test(c.slice(p.length));
}

/**
 * 配置表を組み立てる。plan の moves を渡すと、その案を反映した「案の姿」を返す。
 */
export async function buildOrgChart(
  asOf: string,
  moves: OrgPlanMove[] = [],
): Promise<OrgChartData> {
  await ensureSchema();
  const sql = getSql();

  const units = activeOn(await listOrgUnits(), asOf);
  const tree = buildOrgTree(units, new Map(), new Map());
  const nameById = new Map(units.map((u) => [u.id, u.name]));

  // OrgNode → ChartNode（この時点では people 空）
  const hostByUnitId = new Map<string, ChartNode>();
  const toChart = (n: OrgNode): ChartNode => {
    const node: ChartNode = {
      orgUnitId: n.id,
      orgUnitName: n.name,
      depth: 0,
      people: [],
      children: [],
      span: 1,
      // 自分自身のコード: 職場は職場コード（8桁）、部署は部署コード、本部は組織コード
      sortCode: n.workplaceCode ?? n.deptCode ?? (/^\d+$/.test(n.code) ? n.code : null),
      deptCode: n.deptCode ?? null,
      workplaceCode: n.workplaceCode ?? null,
      parentId: n.parentId ?? null,
      kind: n.kind,
      headEmployeeId: n.headEmployeeId ?? null,
    };
    hostByUnitId.set(n.id, node);
    node.children = n.children.map(toChart);
    return node;
  };
  const roots = tree.map(toChart);

  // 統合する組織の人の並び順（長 → 長代理 → 自組織）を決めるための序列
  const unitRank = new Map<string, number>();

  // 「親の長」の枠を親へ畳む。畳んだ組織の子は親の子として続きに並べる。
  const mergeInto = (node: ChartNode) => {
    const merged: ChartNode[] = [];
    const nextChildren: ChartNode[] = [];
    const queue = [...node.children];
    while (queue.length > 0) {
      const c = queue.shift()!;
      if (mergesIntoParent(node.orgUnitName, c.orgUnitName)) {
        merged.push(c);
        // 畳んだ組織の配下（もし居れば）は親の子として扱う
        queue.unshift(...c.children);
      } else {
        nextChildren.push(c);
      }
    }
    // 「大口工場長」→「大口工場長代理」→「大口工場長付」の順に並べる
    merged.sort((a, b) => positionRank(a.orgUnitName) - positionRank(b.orgUnitName));
    let rank = 0;
    for (const c of merged) {
      hostByUnitId.set(c.orgUnitId, node);
      unitRank.set(c.orgUnitId, rank++);
    }
    unitRank.set(node.orgUnitId, rank);
    node.children = nextChildren;
    for (const c of node.children) mergeInto(c);
  };
  for (const r of roots) mergeInto(r);

  // 同名の兄弟枠は1つに畳む（部署グループ「生産管理部」と部の8桁組織「生産管理部」など）。
  // 子を持つ方を残し、畳んだ方の人はその枠に出す。
  const foldSiblings = (node: ChartNode) => {
    const byKey = new Map<string, ChartNode>();
    const kept: ChartNode[] = [];
    for (const c of node.children) {
      const key = normalizeOrgName(c.orgUnitName);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, c);
        kept.push(c);
        continue;
      }
      let host = prev;
      let absorbed = c;
      if (prev.children.length === 0 && c.children.length > 0) {
        host = c;
        absorbed = prev;
        kept[kept.indexOf(prev)] = c;
        byKey.set(key, c);
      }
      // 畳んだ枠（とそこへ統合済みの組織）の人は残す枠に出す
      hostByUnitId.set(absorbed.orgUnitId, host);
      for (const [uid, h] of hostByUnitId) {
        if (h === absorbed) hostByUnitId.set(uid, host);
      }
      unitRank.set(absorbed.orgUnitId, unitRank.get(host.orgUnitId) ?? 0);
      host.children.push(...absorbed.children);
      if (!host.sortCode) host.sortCode = absorbed.sortCode;
    }
    node.children = kept;
    node.children.forEach(foldSiblings);
  };
  for (const r of roots) foldSiblings(r);

  // 並びは 部署コード → 職場コード の順（コードが無い組織は名前順で末尾側）
  const compareCode = (a: ChartNode, b: ChartNode): number => {
    if (a.sortCode && b.sortCode) {
      const na = Number(a.sortCode);
      const nb = Number(b.sortCode);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      if (a.sortCode !== b.sortCode) return a.sortCode < b.sortCode ? -1 : 1;
      return 0;
    }
    if (a.sortCode) return -1;
    if (b.sortCode) return 1;
    return a.orgUnitName.localeCompare(b.orgUnitName, "ja");
  };
  // 第2階層だけは「部が先、工場が後」。人事システムのコードは工場（12xx）が
  // 部（13xx）より若いので、コード順に任せると工場が上に来てしまう。
  // 帳票では部を上に置くため、ここだけ並びを分ける。
  const compareTop = (a: ChartNode, b: ChartNode): number =>
    (isFactoryOrg(a.orgUnitName) ? 1 : 0) - (isFactoryOrg(b.orgUnitName) ? 1 : 0) ||
    compareCode(a, b);

  const sortTree = (n: ChartNode, depth: number) => {
    n.children.sort(depth === 0 ? compareTop : compareCode);
    n.children.forEach((c) => sortTree(c, depth + 1));
  };
  roots.sort(compareCode);
  roots.forEach((r) => sortTree(r, 0));

  // 深さと行数を計算する
  let maxDepth = 0;
  const settle = (node: ChartNode, depth: number): number => {
    node.depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    if (node.children.length === 0) {
      node.span = 1;
      return 1;
    }
    node.span = node.children.reduce((sum, c) => sum + settle(c, depth + 1), 0);
    return node.span;
  };
  for (const r of roots) settle(r, 0);

  // ===== 人を枠へ入れる =====
  const rows = await sql`
    SELECT e.id, e.employee_no, e.name, e.org_unit_id, e.position_name, e.duty_name
    FROM jinji_employees e
    WHERE e.status <> 'retired'
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;

  const moveByEmployee = new Map(moves.map((m) => [m.employeeId, m]));
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
      orgUnitName: orgUnitId ? (nameById.get(orgUnitId) ?? "") : "",
      // 案で役職・職務も変える場合は、案の値を優先して見せる
      positionName: (move?.toPosition ?? (r.position_name as string | null)) ?? null,
      dutyName: (move?.toDuty ?? (r.duty_name as string | null)) ?? null,
      mark: move?.mark ?? null,
      movingToOrgUnitId: move?.toOrgUnitId ?? null,
      movingToOrgUnitName: move?.toOrgUnitName ?? null,
      incoming: Boolean(move && move.toOrgUnitId && move.toOrgUnitId !== originalOrgId),
    };

    const host = orgUnitId ? hostByUnitId.get(orgUnitId) : undefined;
    if (!host) {
      unassigned.push(person);
      continue;
    }
    host.people.push(person);
  }

  // ===== 兼務の人を枠へ足す =====
  // 本務の人のあとに、その枠を兼務している人を並べる。人数には数えない
  // （在籍者数・部署別人数は本務だけで数える）ので、印を付けて見分けられるようにする。
  for (const m of await listConcurrentMembers(asOf)) {
    const host = hostByUnitId.get(m.orgUnitId);
    if (!host) continue;
    if (host.people.some((p) => p.employeeId === m.employeeId)) continue; // 本務と同じ枠なら出さない
    host.people.push({
      employeeId: m.employeeId,
      employeeNo: m.employeeNo,
      name: m.name,
      orgUnitId: m.orgUnitId,
      orgUnitName: nameById.get(m.orgUnitId) ?? "",
      positionName: m.positionName,
      dutyName: m.dutyName,
      mark: null,
      movingToOrgUnitId: null,
      movingToOrgUnitName: null,
      incoming: false,
      concurrent: true,
    });
  }

  // 枠の中の並び: 本務 → 兼務、本務の中では 長（統合分）→ 自組織、さらにその中では
  //   1. 職務の序列（グループ長・室長…）— 職場を率いているのは職務なので最優先
  //   2. 役職の序列（部長・課長・係長…）
  // 同順位はカナ順のまま。
  const sortPeople = (node: ChartNode) => {
    node.people.sort(
      (a, b) =>
        (a.concurrent ? 1 : 0) - (b.concurrent ? 1 : 0) ||
        (unitRank.get(a.orgUnitId) ?? 99) - (unitRank.get(b.orgUnitId) ?? 99) ||
        dutyRank(a.dutyName) - dutyRank(b.dutyName) ||
        positionRank(a.positionName) - positionRank(b.positionName),
    );
    for (const c of node.children) sortPeople(c);
  };
  for (const r of roots) sortPeople(r);

  // 誰も居ない本部（ポータル由来の部署系統など）は表に出さない。
  // 空の職場は異動の受け皿として残すが、丸ごと空の系統は行のノイズになるだけのため。
  const totalPeople = (n: ChartNode): number =>
    n.people.filter((p) => !p.concurrent).length +
    n.children.reduce((s, c) => s + totalPeople(c), 0);
  const visibleRoots = roots.filter((r) => totalPeople(r) > 0);
  let visibleMaxDepth = 0;
  const measure = (n: ChartNode) => {
    visibleMaxDepth = Math.max(visibleMaxDepth, n.depth);
    for (const c of n.children) measure(c);
  };
  for (const r of visibleRoots) measure(r);

  return { roots: visibleRoots, maxDepth: visibleMaxDepth, unassigned };
}

/** 表示範囲（管理者スコープ）に合わせて、部分木だけを取り出す。見つからなければ空。 */
export function sliceChart(chart: OrgChartData, rootOrgId: string | null): OrgChartData {
  if (!rootOrgId) return chart;
  const find = (list: ChartNode[]): ChartNode | null => {
    for (const n of list) {
      if (n.orgUnitId === rootOrgId) return n;
      const f = find(n.children);
      if (f) return f;
    }
    return null;
  };
  const node = find(chart.roots);
  if (!node) return { roots: [], maxDepth: 0, unassigned: [] };
  let maxDepth = 0;
  const walk = (n: ChartNode) => {
    maxDepth = Math.max(maxDepth, n.depth);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return { roots: [node], maxDepth, unassigned: [] };
}

/**
 * 階層の絞り込み。maxLevels 階層（1始まり）までを表に出し、それより深い配下は
 * 打ち切って「配下 ○組織 ○名」の要約に畳む。null なら絞らない。
 */
export function limitChartDepth(chart: OrgChartData, maxLevels: number | null): OrgChartData {
  if (!maxLevels || maxLevels < 1) return chart;
  const minDepth = chart.roots.length ? Math.min(...chart.roots.map((r) => r.depth)) : 0;
  const cutoff = minDepth + maxLevels - 1;
  if (cutoff >= chart.maxDepth) return chart;

  const countUnits = (n: ChartNode): number =>
    1 + n.children.reduce((s, c) => s + countUnits(c), 0);
  const countPeople = (n: ChartNode): number =>
    n.people.filter((p) => !p.concurrent).length +
    n.children.reduce((s, c) => s + countPeople(c), 0);

  const clone = (n: ChartNode): ChartNode => {
    if (n.depth >= cutoff && n.children.length > 0) {
      const units = countUnits(n) - 1;
      const people = countPeople(n) - n.people.filter((p) => !p.concurrent).length;
      return { ...n, children: [], span: 1, hidden: { units, people } };
    }
    const children = n.children.map(clone);
    return {
      ...n,
      children,
      span: children.length === 0 ? 1 : children.reduce((s, c) => s + c.span, 0),
    };
  };
  return { roots: chart.roots.map(clone), maxDepth: cutoff, unassigned: chart.unassigned };
}

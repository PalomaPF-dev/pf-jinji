import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { mergesIntoParent } from "./orgChart";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * いま何人いるかを、部・工場 → 室・共通・総務 → 職場 の順に数える。
 *
 * ■ 何を数えるか
 *   籍のある人（在籍・休職・出向）。退職者は数えない。
 *
 * ■ 組織図（配置表）と同じ見え方にする
 *   - 「大口工場長」「大口工場長代理」のような親の長の枠は、親（工場）へ寄せる。
 *     配置表でも工場の枠に統合して出しているため、数字も揃える。
 *   - 同名の兄弟枠（人事マスタ由来の部署枠と8桁の組織）は1つに畳む。
 *   - 並びは職場コード → 部署コード（配置表・組織台帳と同じ）。
 */

export interface HeadcountUnit {
  orgId: string;
  name: string;
  /** 部・工場を0とした相対の深さ（0=部・工場、1=室など、2=それ以外の職場） */
  level: number;
  /** その枠に直接いる人数 */
  own: number;
  /** 配下も含めた人数 */
  total: number;
}

export interface HeadcountGroup {
  orgId: string;
  name: string;
  /** 配下も含めた人数 */
  total: number;
  /** 枠に直接いる人数（統合した長の枠を含む） */
  own: number;
  /** 配下の枠（第3・第4階層）。表示順は配置表と同じ */
  units: HeadcountUnit[];
}

export interface HeadcountNow {
  groups: HeadcountGroup[];
  /** 全体の人数 */
  total: number;
  /** どの組織にも紐づいていない人 */
  unassigned: number;
}

interface Node {
  id: string;
  name: string;
  sortCode: string | null;
  own: number;
  children: Node[];
}

/**
 * 現時点の人数を部署・工場・職場ごとに数える。
 * scopeOrgIds が指定されていれば、その範囲の部署だけ返す（工場スコープ）。
 */
export async function headcountByOrg(opts: {
  scopeOrgIds?: string[] | null;
} = {}): Promise<HeadcountNow> {
  await ensureSchema();
  const sql = getSql();
  const scope = opts.scopeOrgIds ?? null;

  const [units, counts] = await Promise.all([
    sql`SELECT id, parent_id, name, dept_code, workplace_code, code FROM jinji_org_units`,
    sql`
      SELECT org_unit_id, count(*)::int AS n
      FROM jinji_employees
      WHERE status <> 'retired'
      GROUP BY org_unit_id`,
  ]);

  const countByOrg = new Map<string | null, number>(
    (counts as any[]).map((r) => [(r.org_unit_id as string | null) ?? null, Number(r.n)]),
  );
  const unassigned = countByOrg.get(null) ?? 0;

  // ===== 木を組む =====
  const nodeById = new Map<string, Node>();
  for (const u of units as any[]) {
    nodeById.set(u.id as string, {
      id: u.id as string,
      name: u.name as string,
      sortCode:
        (u.workplace_code as string | null) ??
        (u.dept_code as string | null) ??
        (/^\d+$/.test(u.code as string) ? (u.code as string) : null),
      own: countByOrg.get(u.id as string) ?? 0,
      children: [],
    });
  }
  const roots: Node[] = [];
  for (const u of units as any[]) {
    const n = nodeById.get(u.id as string)!;
    const p = u.parent_id ? nodeById.get(u.parent_id as string) : null;
    if (p) p.children.push(n);
    else roots.push(n);
  }

  // ===== 親の長の枠・同名の兄弟枠を親へ寄せる（配置表と同じ）=====
  const fold = (node: Node) => {
    const kept: Node[] = [];
    const byName = new Map<string, Node>();
    const queue = [...node.children];
    while (queue.length > 0) {
      const c = queue.shift()!;
      if (mergesIntoParent(node.name, c.name)) {
        node.own += c.own;
        queue.unshift(...c.children); // 畳んだ枠の配下は親の子として続ける
        continue;
      }
      const key = normName(c.name);
      const prev = byName.get(key);
      if (prev) {
        prev.own += c.own;
        prev.children.push(...c.children);
        continue;
      }
      byName.set(key, c);
      kept.push(c);
    }
    node.children = kept;
    node.children.forEach(fold);
  };
  roots.forEach(fold);

  const compare = (a: Node, b: Node): number => {
    if (a.sortCode && b.sortCode) {
      const na = Number(a.sortCode);
      const nb = Number(b.sortCode);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      if (a.sortCode !== b.sortCode) return a.sortCode < b.sortCode ? -1 : 1;
      return 0;
    }
    if (a.sortCode) return -1;
    if (b.sortCode) return 1;
    return a.name.localeCompare(b.name, "ja");
  };
  // 第2階層だけは「部が先、工場が後」。コードは工場（12xx）が部（13xx）より
  // 若いので、コード順に任せると工場が上に来てしまう。組織図と揃える。
  const isFactory = (n: Node) => /工場$/.test(n.name.replace(/[\s　]+/g, ""));
  const compareTop = (a: Node, b: Node): number =>
    (isFactory(a) ? 1 : 0) - (isFactory(b) ? 1 : 0) || compare(a, b);
  const sortTree = (n: Node, depth: number) => {
    n.children.sort(depth === 0 ? compareTop : compare);
    n.children.forEach((c) => sortTree(c, depth + 1));
  };
  roots.sort(compare);
  roots.forEach((r) => sortTree(r, 0));

  const totalOf = (n: Node): number => n.own + n.children.reduce((s, c) => s + totalOf(c), 0);

  // ===== 本部直下（部・工場）を単位に並べる =====
  const groups: HeadcountGroup[] = [];
  for (const root of roots) {
    // 本部に直属している人（本部と同名の組織へ統合された分を含む）。
    // ここを飛ばすと合計が在籍者数と合わなくなる。
    if (!scope && root.own > 0) {
      groups.push({ orgId: root.id, name: root.name, total: root.own, own: root.own, units: [] });
    }
    for (const g of root.children) {
      if (scope && !scope.includes(g.id)) continue;
      const total = totalOf(g);
      if (total === 0) continue; // 誰も居ない系統は出さない（行のノイズになるだけ）
      const list: HeadcountUnit[] = [];
      const walk = (n: Node, level: number) => {
        list.push({ orgId: n.id, name: n.name, level, own: n.own, total: totalOf(n) });
        n.children.forEach((c) => walk(c, level + 1));
      };
      g.children.forEach((c) => walk(c, 1));
      groups.push({ orgId: g.id, name: g.name, total, own: g.own, units: list });
    }
  }

  return {
    groups,
    total: groups.reduce((s, g) => s + g.total, 0),
    unassigned: scope ? 0 : unassigned,
  };
}

/** 表記ゆれ（半角カナ・小さいッ）を吸収した名前。同名判定に使う。 */
function normName(v: string): string {
  return v.normalize("NFKC").replace(/[\s　]+/g, "").replace(/[ッｯ]/g, "");
}

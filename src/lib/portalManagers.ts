import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { mergesIntoParent } from "./orgChart";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 「誰の管理者（承認者）は誰か」を組織図から決める。
 *
 * ポータルの承認フローはユーザーごとの「管理者」で回る。人事管理は組織と職務を
 * 持っているので、そこから機械的に決めて送る。
 *
 * ■ 管理者になる職務（この6つだけ）
 *   部門長 ＞ 工場長A ＞ 工場長B ＞ 室長 ＞ グループ長 ＝ 安全推進工場長室
 *
 *   安全推進工場長室はグループ長と同じ扱い。したがってその人たちの管理者は
 *   （同じ高さのグループ長ではなく）ひとつ上の工場長になる。
 *   工場長代理・センター長・マネージャーなどは管理者にしない（一覧に無いため）。
 *
 * ■ 決め方
 *   自分の所属から組織を上へ辿り、**自分より上位の管理者**が最初に見つかった
 *   ところで止める。同じ枠に複数いれば上位のほうを採る。
 *   「大口工場長」のように工場の枠へ統合される組織の人も、工場の枠の一員として見る。
 *
 * 部門長など最上位の人には管理者が付かない（null で送る）。
 */

/** 管理者の職務と序列（小さいほど上位）。順番に検査する。 */
const MANAGER_DUTIES: { re: RegExp; rank: number }[] = [
  // 「安全推進工場長室」は「工場長」を含むので先に判定する
  { re: /安全推進工場長室/, rank: 4 },
  { re: /部門長/, rank: 0 },
  { re: /工場長[\s　]*[AＡ]/, rank: 1 },
  { re: /工場長[\s　]*[BＢ]/, rank: 2 },
  { re: /室長/, rank: 3 },
  { re: /グループ長|ｸﾞﾙｰﾌﾟ長/, rank: 4 },
];

/** 一般（管理者でない）の序列。上位判定に使うだけの番兵。 */
const NOT_MANAGER = 99;

/** 職務から管理者の序列を求める。管理者でなければ 99。 */
export function managerRank(dutyName: string | null): number {
  const d = (dutyName ?? "").trim();
  if (!d) return NOT_MANAGER;
  for (const { re, rank } of MANAGER_DUTIES) {
    if (re.test(d)) return rank;
  }
  return NOT_MANAGER;
}

interface Person {
  employeeNo: string;
  name: string;
  orgUnitId: string | null;
  rank: number;
}

/**
 * 全社員ぶんの「管理者の社員番号」を返す（社員番号 → 管理者の社員番号）。
 * 管理者が決まらない人は入らない。
 */
export async function resolveManagers(): Promise<Map<string, string>> {
  await ensureSchema();
  const sql = getSql();

  const [units, rows] = await Promise.all([
    sql`SELECT id, parent_id, name FROM jinji_org_units`,
    sql`
      SELECT employee_no, name, org_unit_id, duty_name
      FROM jinji_employees
      WHERE status <> 'retired'
      ORDER BY employee_no ASC`,
  ]);

  const unitById = new Map<string, any>((units as any[]).map((u) => [u.id as string, u]));

  // 「大口工場長」のように親の枠へ統合される組織は、親の一員として扱う。
  // 配置表と同じ規則（mergesIntoParent）を使う。
  const frameOf = new Map<string, string>(); // 組織 → その人を数える枠
  for (const u of units as any[]) {
    const parent = u.parent_id ? unitById.get(u.parent_id as string) : null;
    frameOf.set(
      u.id as string,
      parent && mergesIntoParent(parent.name as string, u.name as string)
        ? (parent.id as string)
        : (u.id as string),
    );
  }

  const people: Person[] = (rows as any[]).map((r) => ({
    employeeNo: r.employee_no as string,
    name: r.name as string,
    orgUnitId: (r.org_unit_id as string | null) ?? null,
    rank: managerRank((r.duty_name as string | null) ?? null),
  }));

  // 枠ごとの管理者（序列の上から）
  const managersOfFrame = new Map<string, Person[]>();
  for (const p of people) {
    if (p.rank === NOT_MANAGER || !p.orgUnitId) continue;
    const frame = frameOf.get(p.orgUnitId) ?? p.orgUnitId;
    const list = managersOfFrame.get(frame) ?? [];
    list.push(p);
    managersOfFrame.set(frame, list);
  }
  for (const list of managersOfFrame.values()) {
    list.sort((a, b) => a.rank - b.rank || a.employeeNo.localeCompare(b.employeeNo));
  }

  const out = new Map<string, string>();
  for (const p of people) {
    if (!p.orgUnitId) continue;
    let frame: string | null = frameOf.get(p.orgUnitId) ?? p.orgUnitId;
    const seen = new Set<string>();
    while (frame && !seen.has(frame)) {
      seen.add(frame);
      const found = (managersOfFrame.get(frame) ?? []).find(
        (m) => m.rank < p.rank && m.employeeNo !== p.employeeNo,
      );
      if (found) {
        out.set(p.employeeNo, found.employeeNo);
        break;
      }
      const u = unitById.get(frame);
      const parentId = (u?.parent_id as string | null) ?? null;
      frame = parentId ? (frameOf.get(parentId) ?? parentId) : null;
    }
  }
  return out;
}

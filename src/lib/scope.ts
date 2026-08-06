import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { JinjiGrant } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ポータル上の管理者（role='admin'）の**表示範囲**。
 *
 * ポータル管理者（ポータル管理権限）は本部全体を見られるが、
 * 各工場の管理者には**ログインした本人が所属する工場（部）だけ**を見せる。
 *
 * 「自分の工場」は本人の社員記録から求める。ログインの社員番号は
 * 社員台帳の社員番号と同じ値（ポータルの login_id）なので、
 * 台帳の所属から親をたどり、本部直下の組織（〜工場・〜部）を範囲の根とする。
 * ポータル側の属性に頼らないのは、組織図の実体はこのアプリが持っており、
 * 名称のゆれや同期漏れで範囲がずれるのを避けるため。
 */
export interface JinjiScope {
  /** null なら全体が見える。配列ならこの組織（配下含む）だけ */
  orgUnitIds: string[] | null;
  /** 範囲の根（自分の工場・部）の組織ID。全体なら null */
  rootOrgId: string | null;
  /** 範囲の根の名前（「大口工場」など）。画面の注記に使う。全体なら null */
  scopeName: string | null;
  /** 範囲があるのに本人の所属が特定できなかった（何も表示しない） */
  unresolved: boolean;
}

export const FULL_SCOPE: JinjiScope = {
  orgUnitIds: null,
  rootOrgId: null,
  scopeName: null,
  unresolved: false,
};

/** ログインIDの表記ゆれ（先頭ゼロの有無）を吸収した候補。 */
function loginIdCandidates(loginId: string): string[] {
  const out = new Set([loginId]);
  if (/^\d+$/.test(loginId)) {
    out.add(loginId.padStart(6, "0"));
    out.add(loginId.replace(/^0+/, ""));
  }
  return [...out].filter(Boolean);
}

/**
 * 表示範囲を求める。ポータル管理者（ポータル管理権限）は常に全体。
 * ポータル上の管理者は自分の工場（本部直下の組織）配下だけ。
 */
export async function getScope(grant: JinjiGrant): Promise<JinjiScope> {
  if (grant.isPortalAdmin || grant.isOwner) return FULL_SCOPE;

  await ensureSchema();
  const sql = getSql();
  const me = await sql`
    SELECT org_unit_id FROM jinji_employees
    WHERE employee_no = ANY(${loginIdCandidates(grant.loginId)}::text[])
      AND org_unit_id IS NOT NULL
    LIMIT 1`;
  const myOrgId = (me[0]?.org_unit_id as string | undefined) ?? null;
  if (!myOrgId) return { orgUnitIds: [], rootOrgId: null, scopeName: null, unresolved: true };

  const units = await sql`SELECT id, parent_id, name FROM jinji_org_units`;
  const byId = new Map(units.map((u: any) => [u.id as string, u]));

  // 自分の所属から根まで遡る。根の1つ下（＝工場・部）が範囲の根。
  // 自分の所属が本部直下ならそこが根（EHS統括室など）。
  const chain: any[] = [];
  const seen = new Set<string>();
  let cur = byId.get(myOrgId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  const top = chain.length >= 2 ? chain[chain.length - 2] : chain[0];
  if (!top) return { orgUnitIds: [], rootOrgId: null, scopeName: null, unresolved: true };

  // 範囲の根の配下すべて（根を含む）
  const children = new Map<string, string[]>();
  for (const u of units) {
    if (!u.parent_id) continue;
    const list = children.get(u.parent_id as string) ?? [];
    list.push(u.id as string);
    children.set(u.parent_id as string, list);
  }
  const ids: string[] = [];
  const stack = [top.id as string];
  const visited = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    ids.push(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return {
    orgUnitIds: ids,
    rootOrgId: top.id as string,
    scopeName: top.name as string,
    unresolved: false,
  };
}

/** 対象の組織が範囲内か。null（全体）は常に true。 */
export function inScope(scope: JinjiScope, orgUnitId: string | null): boolean {
  if (scope.orgUnitIds === null) return true;
  if (!orgUnitId) return false;
  return scope.orgUnitIds.includes(orgUnitId);
}

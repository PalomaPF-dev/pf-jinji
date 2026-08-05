import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { EmployeeChoice } from "@/components/TransferForm";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 異動申請フォームの対象者候補。
 * 「現」欄を自動で埋めるため、現在の所属・役職・職務・等級も一緒に返す。
 * さらに「工場 → 職場 → 対象者」と絞って選べるよう、所属の親をたどって
 * **本部直下の組織（＝工場・部）**も付けて返す。退職者は対象にしない。
 *
 * scopeOrgIds を渡すと、その範囲（管理者の工場）に居る人だけを返す。
 */
export async function listTransferTargets(
  scopeOrgIds: string[] | null = null,
): Promise<EmployeeChoice[]> {
  await ensureSchema();
  const sql = getSql();
  const [rows, units] = await Promise.all([
    sql`
      SELECT e.id, e.employee_no, e.name, e.org_unit_id, e.position_name, e.duty_name, e.grade,
             o.name AS org_unit_name
      FROM jinji_employees e
      LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
      WHERE e.status <> 'retired'
        AND (${scopeOrgIds}::uuid[] IS NULL OR e.org_unit_id = ANY(${scopeOrgIds}::uuid[]))
      ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`,
    sql`SELECT id, parent_id, name FROM jinji_org_units`,
  ]);

  // 組織 → 本部直下の祖先（工場・部）を引けるようにしておく
  const byId = new Map(units.map((u: any) => [u.id as string, u]));
  const topOf = (orgId: string | null): { id: string; name: string } | null => {
    if (!orgId) return null;
    const seen = new Set<string>();
    const chain: any[] = [];
    let cur = byId.get(orgId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    const top = chain.length >= 2 ? chain[chain.length - 2] : chain[0];
    return top ? { id: top.id as string, name: top.name as string } : null;
  };

  return rows.map((r: any) => {
    const top = topOf((r.org_unit_id as string | null) ?? null);
    return {
      id: r.id as string,
      employeeNo: r.employee_no as string,
      name: r.name as string,
      orgUnitId: (r.org_unit_id as string | null) ?? null,
      orgUnitName: (r.org_unit_name as string | null) ?? null,
      positionName: (r.position_name as string | null) ?? null,
      dutyName: (r.duty_name as string | null) ?? null,
      grade: (r.grade as string | null) ?? null,
      factoryId: top?.id ?? null,
      factoryName: top?.name ?? null,
    };
  });
}

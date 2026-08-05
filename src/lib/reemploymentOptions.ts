import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { ReemploymentEmployeeChoice } from "@/components/ReemploymentForm";

/**
 * 継続雇用申請フォームの対象者候補。
 *
 * 年齢は生年月日から画面側で計算するので、生年月日も一緒に返す。
 * 契約満了に伴う申請なので**退職済みは除く**が、雇用体系での絞り込みはしない
 * （正社員の定年後再雇用など、運用の幅を狭めないため）。
 */
export async function listReemploymentTargets(
  scopeOrgIds: string[] | null = null,
): Promise<ReemploymentEmployeeChoice[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT e.id, e.employee_no, e.name, e.employment_type, e.birth_date,
           o.name AS org_unit_name
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE e.status <> 'retired'
      AND (${scopeOrgIds}::uuid[] IS NULL OR e.org_unit_id = ANY(${scopeOrgIds}::uuid[]))
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;
  return rows.map((r) => ({
    id: r.id as string,
    employeeNo: r.employee_no as string,
    name: r.name as string,
    orgUnitName: (r.org_unit_name as string | null) ?? null,
    employmentType: (r.employment_type as string | null) ?? null,
    birthDate: r.birth_date ? new Date(r.birth_date as string).toISOString().slice(0, 10) : null,
  }));
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { EmployeeChoice } from "@/components/TransferForm";

/**
 * 異動申請フォームの対象者候補。
 * 「現」欄を自動で埋めるため、現在の所属・役職・職務・等級も一緒に返す。
 * 退職者は対象にしない。
 */
export async function listTransferTargets(): Promise<EmployeeChoice[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT e.id, e.employee_no, e.name, e.org_unit_id, e.position_name, e.duty_name, e.grade,
           o.name AS org_unit_name
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE e.status <> 'retired'
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;
  return rows.map((r) => ({
    id: r.id as string,
    employeeNo: r.employee_no as string,
    name: r.name as string,
    orgUnitId: (r.org_unit_id as string | null) ?? null,
    orgUnitName: (r.org_unit_name as string | null) ?? null,
    positionName: (r.position_name as string | null) ?? null,
    dutyName: (r.duty_name as string | null) ?? null,
    grade: (r.grade as string | null) ?? null,
  }));
}

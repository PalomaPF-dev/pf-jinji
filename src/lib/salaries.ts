import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { firstOfMonth } from "./dates";
import type { Salary, SalaryAllowance } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 基本給与は**履歴型**で持つ。1社員につき複数行あり、適用開始年月が
 * 最も新しい有効行が「現在の給与」。訂正は voided_at を立てて無効化し、行は消さない
 * （いくらだったかを後から追えないと、給与台帳として成立しないため）。
 */

function mapSalary(r: any): Salary {
  const raw = r.allowances;
  const allowances: SalaryAllowance[] = Array.isArray(raw)
    ? raw
        .filter((a) => a && typeof a === "object")
        .map((a) => ({ name: String(a.name ?? ""), amount: Number(a.amount ?? 0) }))
    : [];
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeNo: r.employee_no ?? "",
    employeeName: r.employee_name ?? "",
    effectiveFrom: toISODate(r.effective_from) ?? "",
    baseSalary: Number(r.base_salary ?? 0),
    allowances,
    grade: r.grade ?? null,
    step: r.step ?? null,
    revisionKind: r.revision_kind ?? "新規登録",
    reason: r.reason ?? null,
    decidedBy: r.decided_by ?? null,
    decidedName: r.decided_name ?? null,
    voidedAt: r.voided_at ? new Date(r.voided_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}

/** 1社員の給与改定履歴（新しい順）。無効化した行も含めて返す（経緯を見せるため）。 */
export async function listSalaryHistory(employeeId: string): Promise<Salary[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT s.*, e.employee_no, e.name AS employee_name
    FROM jinji_salaries s
    JOIN jinji_employees e ON e.id = s.employee_id
    WHERE s.employee_id = ${employeeId}
    ORDER BY s.effective_from DESC, s.created_at DESC`;
  return rows.map(mapSalary);
}

/**
 * 全社員の「現在の給与」一覧。
 * 基準日以前で最も新しい有効行を社員ごとに1本だけ採る（DISTINCT ON）。
 * 在籍者のみ。給与のない社員も一覧には出す（未登録が見えるように LEFT JOIN）。
 */
export async function listCurrentSalaries(asOf: string): Promise<
  { employeeId: string; employeeNo: string; employeeName: string; orgUnitName: string | null; salary: Salary | null }[]
> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT e.id AS employee_id, e.employee_no, e.name AS employee_name,
           o.name AS org_unit_name,
           s.id, s.employee_id AS s_employee_id, s.effective_from, s.base_salary, s.allowances,
           s.grade, s.step, s.revision_kind, s.reason, s.decided_by, s.decided_name,
           s.voided_at, s.created_at
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    LEFT JOIN LATERAL (
      SELECT * FROM jinji_salaries x
      WHERE x.employee_id = e.id AND x.voided_at IS NULL AND x.effective_from <= ${asOf}
      ORDER BY x.effective_from DESC, x.created_at DESC
      LIMIT 1
    ) s ON true
    WHERE e.status <> 'retired'
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;

  return rows.map((r) => ({
    employeeId: r.employee_id as string,
    employeeNo: r.employee_no as string,
    employeeName: r.employee_name as string,
    orgUnitName: (r.org_unit_name as string | null) ?? null,
    salary: r.id
      ? mapSalary({ ...r, employee_id: r.s_employee_id, employee_no: r.employee_no, employee_name: r.employee_name })
      : null,
  }));
}

export interface SalaryInput {
  employeeId: string;
  effectiveFrom: string;
  baseSalary: number;
  allowances: SalaryAllowance[];
  grade: string | null;
  step: string | null;
  revisionKind: string;
  reason: string | null;
}

export function validateSalary(input: SalaryInput): string | null {
  if (!input.employeeId) return "対象者を選んでください。";
  if (!input.effectiveFrom) return "適用開始年月を入力してください。";
  if (!Number.isFinite(input.baseSalary) || input.baseSalary < 0) {
    return "基本給は0以上の数値で入力してください。";
  }
  if (input.baseSalary > 100_000_000) return "基本給の桁が大きすぎます。";
  for (const a of input.allowances) {
    if (!a.name) return "手当の名称を入力してください。";
    if (!Number.isFinite(a.amount) || a.amount < 0) return "手当の金額は0以上の数値で入力してください。";
  }
  return null;
}

/** 給与改定を1本追加する。適用開始日は月初に丸める。 */
export async function createSalary(
  input: SalaryInput,
  decidedBy: string,
  decidedName: string,
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const effective = firstOfMonth(input.effectiveFrom);
  const rows = await sql`
    INSERT INTO jinji_salaries
      (employee_id, effective_from, base_salary, allowances, grade, step,
       revision_kind, reason, decided_by, decided_name)
    VALUES (${input.employeeId}, ${effective}, ${Math.round(input.baseSalary)},
            ${JSON.stringify(input.allowances)}::jsonb, ${input.grade}, ${input.step},
            ${input.revisionKind}, ${input.reason}, ${decidedBy}, ${decidedName})
    RETURNING id`;
  return rows[0].id as string;
}

/**
 * 改定の取り消し（無効化）。行は残したまま voided_at を立てる。
 * 無効化すると、その1つ前の有効行が再び「現在の給与」になる。
 */
export async function voidSalary(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE jinji_salaries SET voided_at = NOW() WHERE id = ${id} AND voided_at IS NULL`;
}

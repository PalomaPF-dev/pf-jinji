import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import {
  EMPLOYMENT_STATUS_ORDER,
  normalizeEmploymentStatus,
  type Employee,
  type EmploymentStatus,
  type Gender,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapEmployee(r: any): Employee {
  return {
    id: r.id,
    employeeNo: r.employee_no,
    name: r.name,
    nameKana: r.name_kana ?? null,
    gender: (r.gender as Gender | null) ?? null,
    birthDate: toISODate(r.birth_date),
    hireDate: toISODate(r.hire_date),
    employmentType: r.employment_type ?? null,
    orgUnitId: r.org_unit_id ?? null,
    orgUnitName: r.org_unit_name ?? null,
    positionName: r.position_name ?? null,
    dutyName: r.duty_name ?? null,
    grade: r.grade ?? null,
    positionCode: r.position_code ?? null,
    dutyCode: r.duty_code ?? null,
    gradeCode: r.grade_code ?? null,
    jobCategory: r.job_category ?? null,
    jobCategoryCode: r.job_category_code ?? null,
    jobGroup: r.job_group ?? null,
    jobGroupCode: r.job_group_code ?? null,
    payClass: r.pay_class ?? null,
    payClassCode: r.pay_class_code ?? null,
    employeeClass: r.employee_class ?? null,
    employeeClassCode: r.employee_class_code ?? null,
    positionClass: r.position_class ?? null,
    positionClassCode: r.position_class_code ?? null,
    payrollOrgCode: r.payroll_org_code ?? null,
    payrollOrgName: r.payroll_org_name ?? null,
    accountOrgCode: r.account_org_code ?? null,
    accountOrgName: r.account_org_name ?? null,
    status: normalizeEmploymentStatus(r.status),
    retireDate: toISODate(r.retire_date),
    email: r.email ?? null,
    phone: r.phone ?? null,
    note: r.note ?? null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

export interface EmployeeFilter {
  /** 社員番号・氏名・カナ・役職の部分一致 */
  q?: string;
  orgUnitId?: string | null;
  status?: EmploymentStatus | "all";
}

/**
 * 社員一覧。既定では在籍者のみ（退職者まで出すと日常の一覧が使いづらいため）。
 * 並びはカナ順。カナ未登録の人は末尾にまとめる。
 */
export async function listEmployees(filter: EmployeeFilter = {}): Promise<Employee[]> {
  await ensureSchema();
  const sql = getSql();
  const q = (filter.q ?? "").trim();
  const like = q ? `%${q}%` : null;
  const status = filter.status ?? "active";
  const statusFilter = status === "all" ? null : normalizeEmploymentStatus(status);
  const orgUnitId = filter.orgUnitId || null;

  // 条件は SQL 側で COALESCE により「未指定なら素通り」にする
  // （tagged template を組み立てずに済み、プレースホルダの取り違えも起きない）。
  const rows = await sql`
    SELECT e.*, o.name AS org_unit_name
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE (${statusFilter}::text IS NULL OR e.status = ${statusFilter})
      AND (${orgUnitId}::uuid IS NULL OR e.org_unit_id = ${orgUnitId})
      AND (${like}::text IS NULL
           OR e.employee_no ILIKE ${like}
           OR e.name ILIKE ${like}
           OR COALESCE(e.name_kana, '') ILIKE ${like}
           OR COALESCE(e.position_name, '') ILIKE ${like}
           OR COALESCE(e.duty_name, '') ILIKE ${like})
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;
  return rows.map(mapEmployee);
}

export async function getEmployee(id: string): Promise<Employee | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT e.*, o.name AS org_unit_name
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE e.id = ${id} LIMIT 1`;
  return rows[0] ? mapEmployee(rows[0]) : null;
}

export async function getEmployeeByNo(employeeNo: string): Promise<Employee | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT e.*, o.name AS org_unit_name
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE e.employee_no = ${employeeNo} LIMIT 1`;
  return rows[0] ? mapEmployee(rows[0]) : null;
}

/** 在籍状態ごとの人数（ダッシュボード用）。 */
export async function countByStatus(): Promise<Record<EmploymentStatus, number>> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT status, count(*)::int AS n FROM jinji_employees GROUP BY status`;
  const out = { active: 0, leave: 0, loaned: 0, retired: 0 } as Record<EmploymentStatus, number>;
  for (const r of rows) {
    const s = normalizeEmploymentStatus(r.status);
    out[s] = r.n as number;
  }
  return out;
}

export interface EmployeeInput {
  employeeNo: string;
  name: string;
  nameKana: string | null;
  gender: Gender | null;
  birthDate: string | null;
  hireDate: string | null;
  employmentType: string | null;
  orgUnitId: string | null;
  positionName: string | null;
  dutyName: string | null;
  grade: string | null;
  status: EmploymentStatus;
  retireDate: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
}

/** 入力値の整合を確認する。問題があればメッセージを返す（無ければ null）。 */
export function validateEmployee(input: EmployeeInput): string | null {
  if (!input.employeeNo.trim()) return "社員番号は必須です。";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.employeeNo)) {
    return "社員番号は半角英数字とハイフン・アンダースコア（1〜64文字）で入力してください。";
  }
  if (!input.name.trim()) return "氏名は必須です。";
  if (!EMPLOYMENT_STATUS_ORDER.includes(input.status)) return "在籍状態が不正です。";
  if (input.status === "retired" && !input.retireDate) return "退職の場合は退職日を入力してください。";
  if (input.birthDate && input.hireDate && input.birthDate > input.hireDate) {
    return "入社日が生年月日より前になっています。";
  }
  if (input.hireDate && input.retireDate && input.retireDate < input.hireDate) {
    return "退職日が入社日より前になっています。";
  }
  return null;
}

export async function createEmployee(input: EmployeeInput): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO jinji_employees
      (employee_no, name, name_kana, gender, birth_date, hire_date, employment_type,
       org_unit_id, position_name, duty_name, grade, status, retire_date, email, phone, note)
    VALUES (${input.employeeNo}, ${input.name}, ${input.nameKana}, ${input.gender},
            ${input.birthDate}, ${input.hireDate}, ${input.employmentType},
            ${input.orgUnitId}, ${input.positionName}, ${input.dutyName}, ${input.grade},
            ${input.status}, ${input.retireDate}, ${input.email}, ${input.phone}, ${input.note})
    RETURNING id`;
  return rows[0].id as string;
}

export async function updateEmployee(id: string, input: EmployeeInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE jinji_employees SET
      employee_no = ${input.employeeNo},
      name = ${input.name},
      name_kana = ${input.nameKana},
      gender = ${input.gender},
      birth_date = ${input.birthDate},
      hire_date = ${input.hireDate},
      employment_type = ${input.employmentType},
      org_unit_id = ${input.orgUnitId},
      position_name = ${input.positionName},
      duty_name = ${input.dutyName},
      grade = ${input.grade},
      status = ${input.status},
      retire_date = ${input.retireDate},
      email = ${input.email},
      phone = ${input.phone},
      note = ${input.note},
      updated_at = NOW()
    WHERE id = ${id}`;
}

/**
 * 社員を削除する。
 * 給与・考課・異動申請・資格も FK の ON DELETE CASCADE で消えるため、
 * 通常は退職（status='retired'）で残すのが正。削除は誤登録の取り消し用。
 */
export async function deleteEmployee(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM jinji_employees WHERE id = ${id}`;
}

/** 上長候補・異動対象の選択用（軽量な一覧）。 */
export async function listEmployeeOptions(): Promise<
  { id: string; employeeNo: string; name: string; orgUnitName: string | null }[]
> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT e.id, e.employee_no, e.name, o.name AS org_unit_name
    FROM jinji_employees e
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE e.status <> 'retired'
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;
  return rows.map((r) => ({
    id: r.id as string,
    employeeNo: r.employee_no as string,
    name: r.name as string,
    orgUnitName: (r.org_unit_name as string | null) ?? null,
  }));
}

// ===== CSV =====

/**
 * CSV の列名。取込・出力で同じ定義を使う。
 * ポータルのユーザー取込に近い並びにして、同じ台帳から作った表をそのまま使えるようにする。
 */
export const EMPLOYEE_CSV_HEADERS = [
  "社員番号",
  "氏名",
  "カナ",
  "性別",
  "生年月日",
  "入社日",
  "雇用体系",
  "所属コード",
  "役職",
  "職務",
  "等級",
  "在籍状態",
  "退職日",
  "メール",
  "電話",
  "備考",
] as const;

const GENDER_FROM_LABEL: Record<string, Gender> = {
  男性: "male",
  男: "male",
  女性: "female",
  女: "female",
  その他: "other",
};

const GENDER_TO_LABEL: Record<Gender, string> = { male: "男性", female: "女性", other: "その他" };

const STATUS_FROM_LABEL: Record<string, EmploymentStatus> = {
  在籍: "active",
  休職: "leave",
  出向: "loaned",
  退職: "retired",
};

const STATUS_TO_LABEL: Record<EmploymentStatus, string> = {
  active: "在籍",
  leave: "休職",
  loaned: "出向",
  retired: "退職",
};

/** 社員1件を CSV 行に。所属は「所属コード」で出す（取込時にそのまま突合できるように）。 */
export function employeeToCsvRow(e: Employee, orgCodeById: Map<string, string>): (string | null)[] {
  return [
    e.employeeNo,
    e.name,
    e.nameKana,
    e.gender ? GENDER_TO_LABEL[e.gender] : null,
    e.birthDate,
    e.hireDate,
    e.employmentType,
    e.orgUnitId ? (orgCodeById.get(e.orgUnitId) ?? null) : null,
    e.positionName,
    e.dutyName,
    e.grade,
    STATUS_TO_LABEL[e.status],
    e.retireDate,
    e.email,
    e.phone,
    e.note,
  ];
}

export interface CsvImportResult {
  created: number;
  updated: number;
  errors: { row: number; employeeNo: string; message: string }[];
}

/** "2026/4/1"・"2026-04-01"・"20260401" を "YYYY-MM-DD" に正規化。空は null。 */
function parseDateCell(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const slash = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (slash) {
    const [, y, m, d] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const packed = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (packed) return `${packed[1]}-${packed[2]}-${packed[3]}`;
  return null;
}

/**
 * CSV を社員台帳へ取り込む。社員番号をキーに upsert する。
 *
 * 1行ずつ独立して処理し、問題のある行だけを errors に積んで残りは通す
 * （1件の書式ミスで数百人の取込が全部止まる方が困るため）。
 */
export async function importEmployeesCsv(records: Record<string, string>[]): Promise<CsvImportResult> {
  await ensureSchema();
  const sql = getSql();

  const orgRows = await sql`SELECT id, code FROM jinji_org_units`;
  const orgIdByCode = new Map(orgRows.map((r) => [r.code as string, r.id as string]));

  const result: CsvImportResult = { created: 0, updated: 0, errors: [] };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const rowNo = i + 2; // ヘッダ行が1行目
    const employeeNo = (rec["社員番号"] ?? "").trim();
    try {
      const orgCode = (rec["所属コード"] ?? "").trim();
      let orgUnitId: string | null = null;
      if (orgCode) {
        orgUnitId = orgIdByCode.get(orgCode) ?? null;
        if (!orgUnitId) {
          result.errors.push({ row: rowNo, employeeNo, message: `所属コード「${orgCode}」が組織に見つかりません。` });
          continue;
        }
      }
      const genderRaw = (rec["性別"] ?? "").trim();
      const statusRaw = (rec["在籍状態"] ?? "").trim();

      const input: EmployeeInput = {
        employeeNo,
        name: (rec["氏名"] ?? "").trim(),
        nameKana: (rec["カナ"] ?? "").trim() || null,
        gender: genderRaw ? (GENDER_FROM_LABEL[genderRaw] ?? null) : null,
        birthDate: parseDateCell(rec["生年月日"] ?? ""),
        hireDate: parseDateCell(rec["入社日"] ?? ""),
        employmentType: (rec["雇用体系"] ?? "").trim() || null,
        orgUnitId,
        positionName: (rec["役職"] ?? "").trim() || null,
        dutyName: (rec["職務"] ?? "").trim() || null,
        grade: (rec["等級"] ?? "").trim() || null,
        status: statusRaw ? (STATUS_FROM_LABEL[statusRaw] ?? "active") : "active",
        retireDate: parseDateCell(rec["退職日"] ?? ""),
        email: (rec["メール"] ?? "").trim() || null,
        phone: (rec["電話"] ?? "").trim() || null,
        note: (rec["備考"] ?? "").trim() || null,
      };

      const problem = validateEmployee(input);
      if (problem) {
        result.errors.push({ row: rowNo, employeeNo, message: problem });
        continue;
      }

      const existing = await sql`SELECT id FROM jinji_employees WHERE employee_no = ${employeeNo} LIMIT 1`;
      if (existing.length > 0) {
        await updateEmployee(existing[0].id as string, input);
        result.updated++;
      } else {
        await createEmployee(input);
        result.created++;
      }
    } catch (e) {
      result.errors.push({ row: rowNo, employeeNo, message: (e as Error).message });
    }
  }

  return result;
}

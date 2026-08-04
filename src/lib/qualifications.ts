import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { addMonths, daysUntil } from "./dates";
import {
  normalizeQualificationCategory,
  type Qualification,
  type QualificationCategory,
  type QualificationMaster,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapQualification(r: any): Qualification {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeNo: r.employee_no ?? "",
    employeeName: r.employee_name ?? "",
    orgUnitName: r.org_unit_name ?? null,
    masterId: r.master_id ?? null,
    name: r.name,
    category: normalizeQualificationCategory(r.category),
    acquiredOn: toISODate(r.acquired_on),
    expiresOn: toISODate(r.expires_on),
    certificateNo: r.certificate_no ?? null,
    issuer: r.issuer ?? null,
    note: r.note ?? null,
  };
}

// ===== 資格マスター =====

export async function listQualificationMasters(activeOnly = true): Promise<QualificationMaster[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = activeOnly
    ? await sql`SELECT * FROM jinji_qualification_master WHERE active ORDER BY sort ASC, name ASC`
    : await sql`SELECT * FROM jinji_qualification_master ORDER BY sort ASC, name ASC`;
  return rows.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    category: normalizeQualificationCategory(r.category),
    renewalRequired: Boolean(r.renewal_required),
    renewalMonths: r.renewal_months == null ? null : Number(r.renewal_months),
    sort: Number(r.sort ?? 0),
    active: Boolean(r.active),
  }));
}

export async function createQualificationMaster(input: {
  code: string;
  name: string;
  category: QualificationCategory;
  renewalRequired: boolean;
  renewalMonths: number | null;
  sort: number;
}): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO jinji_qualification_master (code, name, category, renewal_required, renewal_months, sort)
    VALUES (${input.code}, ${input.name}, ${input.category}, ${input.renewalRequired},
            ${input.renewalMonths}, ${input.sort})
    RETURNING id`;
  return rows[0].id as string;
}

export async function deleteQualificationMaster(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  // 保有資格からは参照を外すだけ（取得実績そのものは消さない）
  await sql`DELETE FROM jinji_qualification_master WHERE id = ${id}`;
}

// ===== 保有資格 =====

export interface QualificationFilter {
  employeeId?: string | null;
  category?: QualificationCategory | "all";
  /** true: 有効期限が近い/切れているものだけ */
  expiringOnly?: boolean;
  /** 期限判定の基準日 */
  today?: string;
  /** 何日以内を「近い」とみなすか */
  withinDays?: number;
}

export async function listQualifications(filter: QualificationFilter = {}): Promise<Qualification[]> {
  await ensureSchema();
  const sql = getSql();
  const employeeId = filter.employeeId || null;
  const category = filter.category && filter.category !== "all" ? filter.category : null;

  const rows = await sql`
    SELECT q.*, e.employee_no, e.name AS employee_name, o.name AS org_unit_name
    FROM jinji_qualifications q
    JOIN jinji_employees e ON e.id = q.employee_id
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE (${employeeId}::uuid IS NULL OR q.employee_id = ${employeeId})
      AND (${category}::text IS NULL OR q.category = ${category})
      AND e.status <> 'retired'
    ORDER BY (q.expires_on IS NULL), q.expires_on ASC, q.name ASC`;

  let list = rows.map(mapQualification);
  if (filter.expiringOnly) {
    const today = filter.today ?? new Date().toISOString().slice(0, 10);
    const within = filter.withinDays ?? 90;
    list = list.filter((q) => q.expiresOn != null && daysUntil(q.expiresOn, today) <= within);
  }
  return list;
}

/** 期限切れ・期限接近の件数（ダッシュボード用）。 */
export async function countExpiring(today: string, withinDays = 90): Promise<{ expired: number; soon: number }> {
  const list = await listQualifications({});
  let expired = 0;
  let soon = 0;
  for (const q of list) {
    if (!q.expiresOn) continue;
    const d = daysUntil(q.expiresOn, today);
    if (d < 0) expired++;
    else if (d <= withinDays) soon++;
  }
  return { expired, soon };
}

export interface QualificationInput {
  employeeId: string;
  masterId: string | null;
  name: string;
  category: QualificationCategory;
  acquiredOn: string | null;
  expiresOn: string | null;
  certificateNo: string | null;
  issuer: string | null;
  note: string | null;
}

export function validateQualification(input: QualificationInput): string | null {
  if (!input.employeeId) return "対象者を選んでください。";
  if (!input.name.trim()) return "資格名は必須です。";
  if (input.acquiredOn && input.expiresOn && input.expiresOn < input.acquiredOn) {
    return "有効期限が取得日より前になっています。";
  }
  return null;
}

/**
 * 保有資格を登録する。
 * マスターを選んでいて更新が必要な資格なら、有効期限が空でも取得日から自動計算する
 * （更新間隔がマスターにあるのに期限が抜ける、という取りこぼしを防ぐ）。
 */
export async function createQualification(input: QualificationInput): Promise<string> {
  await ensureSchema();
  const sql = getSql();

  let expiresOn = input.expiresOn;
  if (!expiresOn && input.masterId && input.acquiredOn) {
    const m = await sql`
      SELECT renewal_required, renewal_months FROM jinji_qualification_master
      WHERE id = ${input.masterId} LIMIT 1`;
    const months = m[0]?.renewal_required ? Number(m[0].renewal_months ?? 0) : 0;
    if (months > 0) expiresOn = addMonths(input.acquiredOn, months);
  }

  const rows = await sql`
    INSERT INTO jinji_qualifications
      (employee_id, master_id, name, category, acquired_on, expires_on, certificate_no, issuer, note)
    VALUES (${input.employeeId}, ${input.masterId}, ${input.name}, ${input.category},
            ${input.acquiredOn}, ${expiresOn}, ${input.certificateNo}, ${input.issuer}, ${input.note})
    RETURNING id`;
  return rows[0].id as string;
}

export async function deleteQualification(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM jinji_qualifications WHERE id = ${id}`;
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { addDays, addMonths } from "./dates";
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
    groupName: r.group_name ?? null,
    code: r.code ?? null,
    acquiredOn: toISODate(r.acquired_on),
    expiresOn: toISODate(r.expires_on),
    certifiedOn: toISODate(r.certified_on),
    appliedFrom: toISODate(r.applied_from),
    holderRole: r.holder_role ?? null,
    allowancePaid: r.allowance_paid == null ? null : Boolean(r.allowance_paid),
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
    groupName: (r.group_name as string | null) ?? null,
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
  /** 人事システムの区分（法令資格修了者 等）。"all" は絞らない */
  group?: string | null;
  /** 資格コード（4桁）。"all"/空は絞らない */
  code?: string | null;
  /** 氏名・社員番号・資格名の部分一致 */
  keyword?: string | null;
  /** true: 有効期限が近い/切れているものだけ */
  expiringOnly?: boolean;
  /** 期限判定の基準日 */
  today?: string;
  /** 何日以内を「近い」とみなすか */
  withinDays?: number;
  /** 表示範囲（管理者の工場スコープ）。null は全体 */
  scopeOrgIds?: string[] | null;
  /** 取り出す上限（画面で全件を描くと数千行になるため） */
  limit?: number;
}

export interface QualificationList {
  rows: Qualification[];
  /** 絞り込みに合う総件数（limit の前） */
  total: number;
}

export async function listQualifications(filter: QualificationFilter = {}): Promise<QualificationList> {
  await ensureSchema();
  const sql = getSql();
  const employeeId = filter.employeeId || null;
  const category = filter.category && filter.category !== "all" ? filter.category : null;
  const group = filter.group && filter.group !== "all" ? filter.group : null;
  const code = filter.code && filter.code !== "all" ? filter.code : null;
  const keyword = (filter.keyword ?? "").trim() || null;
  const scope = filter.scopeOrgIds ?? null;
  const limit = filter.limit ?? 500;
  // 期限の絞り込みも SQL でやる（数千行を全部持ってきてから捨てないため）
  const today = filter.today ?? new Date().toISOString().slice(0, 10);
  const until = filter.expiringOnly ? addDays(today, filter.withinDays ?? 90) : null;

  const rows = await sql`
    SELECT q.*, m.group_name, e.employee_no, e.name AS employee_name, o.name AS org_unit_name,
           count(*) OVER ()::int AS total_count
    FROM jinji_qualifications q
    JOIN jinji_employees e ON e.id = q.employee_id
    LEFT JOIN jinji_qualification_master m ON m.id = q.master_id
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE (${employeeId}::uuid IS NULL OR q.employee_id = ${employeeId})
      AND (${category}::text IS NULL OR q.category = ${category})
      AND (${group}::text IS NULL OR m.group_name = ${group})
      AND (${code}::text IS NULL OR q.code = ${code})
      AND (${keyword}::text IS NULL
           OR e.name ILIKE '%' || ${keyword} || '%'
           OR e.employee_no ILIKE '%' || ${keyword} || '%'
           OR q.name ILIKE '%' || ${keyword} || '%')
      AND (${scope}::uuid[] IS NULL OR e.org_unit_id = ANY(${scope}::uuid[]))
      AND (${until}::date IS NULL OR (q.expires_on IS NOT NULL AND q.expires_on <= ${until}::date))
      AND e.status <> 'retired'
    ORDER BY (q.expires_on IS NULL), q.expires_on ASC, q.name ASC, e.employee_no ASC
    LIMIT ${limit}`;

  return {
    rows: rows.map(mapQualification),
    total: rows.length > 0 ? Number((rows[0] as any).total_count) : 0,
  };
}

/** 区分の一覧（絞り込みの選択肢）。取込で入った区分だけを出す。 */
export async function listQualificationGroups(): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT DISTINCT group_name FROM jinji_qualification_master
    WHERE group_name IS NOT NULL AND group_name <> '' ORDER BY group_name ASC`;
  return (rows as any[]).map((r) => r.group_name as string);
}

/** 資格ごとの保有者数（一覧の絞り込みと「誰が持っているか」の入口）。 */
export async function countByQualification(scopeOrgIds?: string[] | null): Promise<
  { code: string; name: string; groupName: string | null; holders: number }[]
> {
  await ensureSchema();
  const sql = getSql();
  const scope = scopeOrgIds ?? null;
  const rows = await sql`
    SELECT COALESCE(q.code, '') AS code, q.name, m.group_name, count(*)::int AS holders
    FROM jinji_qualifications q
    JOIN jinji_employees e ON e.id = q.employee_id
    LEFT JOIN jinji_qualification_master m ON m.id = q.master_id
    WHERE e.status <> 'retired'
      AND (${scope}::uuid[] IS NULL OR e.org_unit_id = ANY(${scope}::uuid[]))
    GROUP BY 1, 2, 3
    ORDER BY code ASC, q.name ASC`;
  return (rows as any[]).map((r) => ({
    code: r.code as string,
    name: r.name as string,
    groupName: (r.group_name as string | null) ?? null,
    holders: Number(r.holders),
  }));
}

/** 期限切れ・期限接近の件数（ダッシュボード用）。数を数えるだけなのでSQLで済ませる。 */
export async function countExpiring(today: string, withinDays = 90): Promise<{ expired: number; soon: number }> {
  await ensureSchema();
  const sql = getSql();
  const until = addDays(today, withinDays);
  const rows = await sql`
    SELECT
      count(*) FILTER (WHERE q.expires_on < ${today}::date)::int AS expired,
      count(*) FILTER (WHERE q.expires_on >= ${today}::date AND q.expires_on <= ${until}::date)::int AS soon
    FROM jinji_qualifications q
    JOIN jinji_employees e ON e.id = q.employee_id
    WHERE q.expires_on IS NOT NULL AND e.status <> 'retired'`;
  return { expired: Number(rows[0]?.expired ?? 0), soon: Number(rows[0]?.soon ?? 0) };
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

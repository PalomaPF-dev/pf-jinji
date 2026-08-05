import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { buildReemploymentNo } from "./transferForm";
import {
  REEMPLOYMENT_APPROVAL_SLOTS,
  REEMPLOYMENT_FIXED_TEXT,
  REEMPLOYMENT_DUTY_COUNT,
  REEMPLOYMENT_REASON_COUNT,
  normalizeReemploymentStatus,
  type ApprovalDecision,
  type Reemployment,
  type ReemploymentApproval,
  type ReemploymentApprovalSlot,
  type ReemploymentStatus,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 継続雇用申請書（指定帳票 **J-456**）のデータ層。
 *
 * 高齢者雇用・アルバイト契約の満了に伴い、期間を限って雇用を継続することを申請する。
 * 異動申請と違い**人事マスターへの発令は伴わない**（承認までで完結する帳票）ので、
 * applyTransfer に相当する処理は持たない。雇用形態や契約満了日を実際に書き換えるのは
 * 人事マスターの編集画面の役割にしてある。
 */

function textList(v: unknown, size: number): string[] {
  const raw = typeof v === "string" ? safeParse(v) : v;
  const arr = Array.isArray(raw) ? raw.map((x) => (typeof x === "string" ? x : "")) : [];
  return Array.from({ length: size }, (_, i) => arr[i] ?? "");
}

function safeParse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapReemployment(r: any): Reemployment {
  return {
    id: r.id,
    docNo: r.doc_no,
    employeeId: r.employee_id,
    employeeNo: r.employee_no ?? "",
    employeeName: r.employee_name ?? "",
    orgUnitName: r.org_unit_name ?? null,
    currentEmploymentType: r.current_employment_type ?? null,
    contractEndDate: toISODate(r.contract_end_date),
    employmentType: r.employment_type ?? null,
    periodFrom: toISODate(r.period_from),
    periodTo: toISODate(r.period_to),
    workPlace: r.work_place ?? null,
    daysPerWeek: num(r.days_per_week),
    workStart: r.work_start ?? null,
    workEnd: r.work_end ?? null,
    breakHours: num(r.break_hours),
    duties: textList(r.duties, REEMPLOYMENT_DUTY_COUNT),
    reasons: textList(r.reasons, REEMPLOYMENT_REASON_COUNT),
    compliance: r.compliance ?? null,
    conclusion: r.conclusion ?? null,
    status: normalizeReemploymentStatus(r.status),
    draftedBy: r.drafted_by ?? null,
    draftedName: r.drafted_name ?? null,
    formDate: toISODate(r.form_date),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

function mapApproval(r: any): ReemploymentApproval {
  const slot = r.slot as ReemploymentApprovalSlot;
  return {
    id: r.id,
    reemploymentId: r.reemployment_id,
    slot,
    label: REEMPLOYMENT_APPROVAL_SLOTS.find((s) => s.slot === slot)?.label ?? slot,
    seq: Number(r.seq ?? 0),
    approverLoginId: r.approver_login_id ?? null,
    approverName: r.approver_name ?? null,
    decision: (r.decision as ApprovalDecision) ?? "pending",
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    comment: r.comment ?? null,
  };
}

// ===== 取得 =====

export interface ReemploymentFilter {
  employeeId?: string | null;
  status?: ReemploymentStatus | "all";
  q?: string;
  /** 表示範囲（管理者の工場スコープ）。null は全体 */
  scopeOrgIds?: string[] | null;
}

export async function listReemployments(filter: ReemploymentFilter = {}): Promise<Reemployment[]> {
  await ensureSchema();
  const sql = getSql();
  const employeeId = filter.employeeId || null;
  const status = filter.status && filter.status !== "all" ? filter.status : null;
  const q = (filter.q ?? "").trim();
  const like = q ? `%${q}%` : null;
  const scope = filter.scopeOrgIds ?? null;

  const rows = await sql`
    SELECT r.*, e.employee_no, e.name AS employee_name
    FROM jinji_reemployments r
    JOIN jinji_employees e ON e.id = r.employee_id
    WHERE (${employeeId}::uuid IS NULL OR r.employee_id = ${employeeId})
      AND (${status}::text IS NULL OR r.status = ${status})
      AND (${scope}::uuid[] IS NULL OR e.org_unit_id = ANY(${scope}::uuid[]))
      AND (${like}::text IS NULL
           OR r.doc_no ILIKE ${like}
           OR e.name ILIKE ${like}
           OR e.employee_no ILIKE ${like})
    ORDER BY r.created_at DESC`;
  return rows.map(mapReemployment);
}

export async function getReemployment(id: string): Promise<Reemployment | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT r.*, e.employee_no, e.name AS employee_name
    FROM jinji_reemployments r
    JOIN jinji_employees e ON e.id = r.employee_id
    WHERE r.id = ${id} LIMIT 1`;
  return rows[0] ? mapReemployment(rows[0]) : null;
}

export async function listReemploymentApprovals(reemploymentId: string): Promise<ReemploymentApproval[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM jinji_reemployment_approvals
    WHERE reemployment_id = ${reemploymentId} ORDER BY seq`;
  return rows.map(mapApproval);
}

/** ダッシュボード用: 未処理（起案中・申請中）の件数。 */
export async function countOpenReemployments(): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT count(*)::int AS n FROM jinji_reemployments WHERE status IN ('draft','submitted')`;
  return Number(rows[0]?.n ?? 0);
}

// ===== 作成・更新 =====

export interface ReemploymentInput {
  employeeId: string;
  orgUnitName: string | null;
  currentEmploymentType: string | null;
  contractEndDate: string | null;
  employmentType: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  workPlace: string | null;
  daysPerWeek: number | null;
  workStart: string | null;
  workEnd: string | null;
  breakHours: number | null;
  duties: string[];
  reasons: string[];
  compliance: string | null;
  conclusion: string | null;
  formDate: string | null;
}

export function validateReemployment(input: ReemploymentInput): string | null {
  if (!input.employeeId) return "対象者を選んでください。";
  if (!input.contractEndDate) return "契約満了日を入力してください。";
  if (!input.periodFrom || !input.periodTo) return "契約期間を入力してください。";
  if (input.periodFrom > input.periodTo) return "契約期間の開始日が終了日より後になっています。";
  // 満了の翌日から始まらない契約は運用ミスの可能性が高いので、遡りだけ止める
  if (input.periodFrom < input.contractEndDate) {
    return "契約期間の開始日が、現在の契約満了日より前になっています。";
  }
  if (input.daysPerWeek !== null && (input.daysPerWeek <= 0 || input.daysPerWeek > 7)) {
    return "勤務日数は週1〜7日の範囲で入力してください。";
  }
  if (input.duties.every((d) => !d.trim())) return "業務内容を1つ以上入力してください。";
  if (input.reasons.every((r) => !r.trim())) {
    return "継続雇用の理由・必要性を1つ以上入力してください。";
  }
  return null;
}

async function nextReemploymentNo(year: number): Promise<string> {
  const sql = getSql();
  await sql`INSERT INTO jinji_counters (year, seq) VALUES (${year}, 0) ON CONFLICT (year) DO NOTHING`;
  const rows = await sql`
    UPDATE jinji_counters SET reemp_seq = reemp_seq + 1 WHERE year = ${year} RETURNING reemp_seq`;
  return buildReemploymentNo(year, rows[0].reemp_seq as number);
}

export async function createReemployment(
  input: ReemploymentInput,
  draftedBy: string,
  draftedName: string,
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const year = new Date().getFullYear();
  const docNo = await nextReemploymentNo(year);

  // 所属は申請時点の名称を焼き付ける（後から組織が変わっても帳票は当時のまま）
  let orgUnitName = input.orgUnitName;
  if (!orgUnitName) {
    const e = await sql`
      SELECT o.name FROM jinji_employees e
      LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
      WHERE e.id = ${input.employeeId} LIMIT 1`;
    orgUnitName = (e[0]?.name as string | null) ?? null;
  }

  const rows = await sql`
    INSERT INTO jinji_reemployments
      (doc_no, employee_id, org_unit_name, current_employment_type, contract_end_date,
       employment_type, period_from, period_to, work_place, days_per_week,
       work_start, work_end, break_hours, duties, reasons, compliance, conclusion,
       status, drafted_by, drafted_name, form_date)
    VALUES (${docNo}, ${input.employeeId}, ${orgUnitName}, ${input.currentEmploymentType},
            ${input.contractEndDate}, ${input.employmentType}, ${input.periodFrom}, ${input.periodTo},
            ${input.workPlace}, ${input.daysPerWeek},
            ${input.workStart}, ${input.workEnd}, ${input.breakHours},
            ${JSON.stringify(input.duties)}::jsonb, ${JSON.stringify(input.reasons)}::jsonb,
            ${input.compliance ?? REEMPLOYMENT_FIXED_TEXT.compliance},
            ${input.conclusion ?? REEMPLOYMENT_FIXED_TEXT.conclusion2},
            'draft', ${draftedBy}, ${draftedName}, ${input.formDate})
    RETURNING id`;
  const id = rows[0].id as string;

  for (let i = 0; i < REEMPLOYMENT_APPROVAL_SLOTS.length; i++) {
    const s = REEMPLOYMENT_APPROVAL_SLOTS[i];
    await sql`
      INSERT INTO jinji_reemployment_approvals (reemployment_id, slot, seq)
      VALUES (${id}, ${s.slot}, ${i})
      ON CONFLICT (reemployment_id, slot) DO NOTHING`;
  }
  return id;
}

/** 起案中・差戻の申請だけ編集できる（承認後に内容が変わると帳票と実態がずれるため）。 */
export async function updateReemployment(id: string, input: ReemploymentInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_reemployments WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  const status = normalizeReemploymentStatus(cur[0].status);
  if (status !== "draft" && status !== "rejected") {
    throw new Error("申請中・承認済みの申請書は編集できません。差し戻してから修正してください。");
  }
  await sql`
    UPDATE jinji_reemployments SET
      employee_id = ${input.employeeId},
      org_unit_name = ${input.orgUnitName},
      current_employment_type = ${input.currentEmploymentType},
      contract_end_date = ${input.contractEndDate},
      employment_type = ${input.employmentType},
      period_from = ${input.periodFrom},
      period_to = ${input.periodTo},
      work_place = ${input.workPlace},
      days_per_week = ${input.daysPerWeek},
      work_start = ${input.workStart},
      work_end = ${input.workEnd},
      break_hours = ${input.breakHours},
      duties = ${JSON.stringify(input.duties)}::jsonb,
      reasons = ${JSON.stringify(input.reasons)}::jsonb,
      compliance = ${input.compliance},
      conclusion = ${input.conclusion},
      form_date = ${input.formDate},
      updated_at = NOW()
    WHERE id = ${id}`;
}

export async function deleteReemployment(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_reemployments WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) return;
  if (normalizeReemploymentStatus(cur[0].status) === "approved") {
    throw new Error("承認済みの申請書は削除できません。");
  }
  await sql`DELETE FROM jinji_reemployments WHERE id = ${id}`;
}

// ===== 申請・承認 =====

export async function submitReemployment(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_reemployments WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  const status = normalizeReemploymentStatus(cur[0].status);
  if (status !== "draft" && status !== "rejected") {
    throw new Error("この申請書は既に申請済みです。");
  }
  // 差戻からの再申請では、前回の押印を全部消してから回す
  await sql.transaction([
    sql`UPDATE jinji_reemployments SET status = 'submitted', updated_at = NOW() WHERE id = ${id}`,
    sql`
      UPDATE jinji_reemployment_approvals
      SET decision = 'pending', decided_at = NULL, approver_login_id = NULL,
          approver_name = NULL, comment = NULL
      WHERE reemployment_id = ${id}`,
  ]);
}

export async function decideReemploymentApproval(
  reemploymentId: string,
  slot: ReemploymentApprovalSlot,
  decision: Exclude<ApprovalDecision, "pending">,
  approverLoginId: string,
  approverName: string,
  comment: string | null,
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_reemployments WHERE id = ${reemploymentId} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  if (normalizeReemploymentStatus(cur[0].status) !== "submitted") {
    throw new Error("申請中の申請書だけが承認・差戻できます。");
  }

  await sql`
    UPDATE jinji_reemployment_approvals
    SET decision = ${decision}, decided_at = NOW(),
        approver_login_id = ${approverLoginId}, approver_name = ${approverName},
        comment = ${comment}
    WHERE reemployment_id = ${reemploymentId} AND slot = ${slot}`;

  const rows = await sql`
    SELECT decision FROM jinji_reemployment_approvals WHERE reemployment_id = ${reemploymentId}`;
  const decisions = rows.map((r) => r.decision as ApprovalDecision);
  let next: ReemploymentStatus | null = null;
  if (decisions.includes("rejected")) next = "rejected";
  else if (decisions.length > 0 && decisions.every((d) => d === "approved")) next = "approved";
  if (next) {
    await sql`UPDATE jinji_reemployments SET status = ${next}, updated_at = NOW() WHERE id = ${reemploymentId}`;
  }
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { buildTransferNo } from "./transferForm";
import {
  TRANSFER_APPROVAL_SLOTS,
  normalizeTransferFormKind,
  normalizeTransferKind,
  normalizeTransferStatus,
  type ApprovalDecision,
  type Transfer,
  type TransferApproval,
  type TransferApprovalSlot,
  type TransferFormKind,
  type TransferKind,
  type TransferStatus,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapTransfer(r: any): Transfer {
  return {
    id: r.id,
    transferNo: r.transfer_no,
    employeeId: r.employee_id,
    employeeNo: r.employee_no ?? "",
    employeeName: r.employee_name ?? "",
    kind: normalizeTransferKind(r.kind),
    fromOrgUnitId: r.from_org_unit_id ?? null,
    fromOrgUnitName: r.from_org_name ?? null,
    toOrgUnitId: r.to_org_unit_id ?? null,
    toOrgUnitName: r.to_org_name ?? null,
    fromPosition: r.from_position ?? null,
    toPosition: r.to_position ?? null,
    fromDuty: r.from_duty ?? null,
    toDuty: r.to_duty ?? null,
    fromGrade: r.from_grade ?? null,
    toGrade: r.to_grade ?? null,
    orderDate: toISODate(r.order_date),
    effectiveDate: toISODate(r.effective_date),
    reason: r.reason ?? null,
    remarks: r.remarks ?? null,
    status: normalizeTransferStatus(r.status),
    draftedBy: r.drafted_by ?? null,
    draftedName: r.drafted_name ?? null,
    appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,

    // ===== 指定帳票 J-426(9) の記入欄 =====
    formKind: normalizeTransferFormKind(r.form_kind),
    formDate: toISODate(r.form_date),
    arrivalDate: toISODate(r.arrival_date),
    limitedFrom: toISODate(r.limited_from),
    limitedTo: toISODate(r.limited_to),
    deptAgreement: r.dept_agreement ?? null,
    orgNameBefore: r.org_name_before ?? null,
    orgNameAfter: r.org_name_after ?? null,
    relocation: r.relocation ?? null,
    housingBefore: r.housing_before ?? null,
    housingAfter: r.housing_after ?? null,
    assignmentBefore: r.assignment_before ?? null,
    assignmentAfter: r.assignment_after ?? null,
    singleReasons: numberList(r.single_reasons),
    mobile: r.mobile ?? null,
    mobileAfter: r.mobile_after ?? null,
    companyCar: r.company_car ?? null,
    companyCarAfter: r.company_car_after ?? null,
    companyCarOther: r.company_car_other ?? null,
    parking: r.parking ?? null,
    commuteChange: r.commute_change ?? null,
    explainedAgreed: Boolean(r.explained_agreed),
    successorChecked: Boolean(r.successor_checked),
    systemDeptCode: r.system_dept_code ?? null,
    systemDeptName: r.system_dept_name ?? null,
  };
}

/**
 * jsonb 列を数値配列として読む。ドライバによって配列が来たり
 * JSON文字列が来たりするので両方を受ける。
 */
function numberList(v: unknown): number[] {
  const raw = typeof v === "string" ? safeParse(v) : v;
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0);
}

function safeParse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function mapApproval(r: any): TransferApproval {
  const slot = r.slot as TransferApprovalSlot;
  return {
    id: r.id,
    transferId: r.transfer_id,
    slot,
    label: TRANSFER_APPROVAL_SLOTS.find((s) => s.slot === slot)?.label ?? slot,
    seq: Number(r.seq ?? 0),
    approverLoginId: r.approver_login_id ?? null,
    approverName: r.approver_name ?? null,
    decision: (r.decision as ApprovalDecision) ?? "pending",
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    comment: r.comment ?? null,
  };
}

// ===== 取得 =====

export interface TransferFilter {
  employeeId?: string | null;
  status?: TransferStatus | "all";
  q?: string;
}

export async function listTransfers(filter: TransferFilter = {}): Promise<Transfer[]> {
  await ensureSchema();
  const sql = getSql();
  const employeeId = filter.employeeId || null;
  const status = filter.status && filter.status !== "all" ? filter.status : null;
  const q = (filter.q ?? "").trim();
  const like = q ? `%${q}%` : null;

  const rows = await sql`
    SELECT t.*, e.employee_no, e.name AS employee_name,
           fo.name AS from_org_name, too.name AS to_org_name
    FROM jinji_transfers t
    JOIN jinji_employees e ON e.id = t.employee_id
    LEFT JOIN jinji_org_units fo ON fo.id = t.from_org_unit_id
    LEFT JOIN jinji_org_units too ON too.id = t.to_org_unit_id
    WHERE (${employeeId}::uuid IS NULL OR t.employee_id = ${employeeId})
      AND (${status}::text IS NULL OR t.status = ${status})
      AND (${like}::text IS NULL
           OR t.transfer_no ILIKE ${like}
           OR e.name ILIKE ${like}
           OR e.employee_no ILIKE ${like})
    ORDER BY t.created_at DESC`;
  return rows.map(mapTransfer);
}

export async function getTransfer(id: string): Promise<Transfer | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT t.*, e.employee_no, e.name AS employee_name,
           fo.name AS from_org_name, too.name AS to_org_name
    FROM jinji_transfers t
    JOIN jinji_employees e ON e.id = t.employee_id
    LEFT JOIN jinji_org_units fo ON fo.id = t.from_org_unit_id
    LEFT JOIN jinji_org_units too ON too.id = t.to_org_unit_id
    WHERE t.id = ${id} LIMIT 1`;
  return rows[0] ? mapTransfer(rows[0]) : null;
}

export async function listApprovals(transferId: string): Promise<TransferApproval[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM jinji_transfer_approvals WHERE transfer_id = ${transferId} ORDER BY seq ASC`;
  return rows.map(mapApproval);
}

/** 未処理（起案中・申請中・承認済で未発令）の件数。ダッシュボード用。 */
export async function countOpenTransfers(): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT count(*)::int AS n FROM jinji_transfers WHERE status IN ('draft','submitted','approved')`;
  return (rows[0]?.n as number) ?? 0;
}

/**
 * 発令日を過ぎているのに未反映の承認済み申請。
 * 「承認したのに人事マスターへ反映し忘れている」ものを拾う。
 */
export async function listDueTransfers(today: string): Promise<Transfer[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT t.*, e.employee_no, e.name AS employee_name,
           fo.name AS from_org_name, too.name AS to_org_name
    FROM jinji_transfers t
    JOIN jinji_employees e ON e.id = t.employee_id
    LEFT JOIN jinji_org_units fo ON fo.id = t.from_org_unit_id
    LEFT JOIN jinji_org_units too ON too.id = t.to_org_unit_id
    WHERE t.status = 'approved'
      AND t.effective_date IS NOT NULL
      AND t.effective_date <= ${today}
    ORDER BY t.effective_date ASC`;
  return rows.map(mapTransfer);
}

// ===== 作成・更新 =====

export interface TransferInput {
  employeeId: string;
  kind: TransferKind;
  fromOrgUnitId: string | null;
  toOrgUnitId: string | null;
  fromPosition: string | null;
  toPosition: string | null;
  fromDuty: string | null;
  toDuty: string | null;
  fromGrade: string | null;
  toGrade: string | null;
  orderDate: string | null;
  effectiveDate: string | null;
  reason: string | null;
  remarks: string | null;

  // ===== 指定帳票 J-426(9) の記入欄 =====
  formKind: TransferFormKind;
  formDate: string | null;
  arrivalDate: string | null;
  limitedFrom: string | null;
  limitedTo: string | null;
  deptAgreement: string | null;
  orgNameBefore: string | null;
  orgNameAfter: string | null;
  relocation: string | null;
  housingBefore: string | null;
  housingAfter: string | null;
  assignmentBefore: string | null;
  assignmentAfter: string | null;
  singleReasons: number[];
  mobile: string | null;
  mobileAfter: string | null;
  companyCar: string | null;
  companyCarAfter: string | null;
  companyCarOther: string | null;
  parking: string | null;
  commuteChange: string | null;
  explainedAgreed: boolean;
  successorChecked: boolean;
  systemDeptCode: string | null;
  systemDeptName: string | null;
}

export function validateTransfer(input: TransferInput): string | null {
  if (!input.employeeId) return "対象者を選んでください。";

  // 組織名称追加変更として起票した場合は、人の異動を伴わない。
  // 帳票の【組織名称】欄だけが要るので、異動側の必須チェックはかけない。
  if (input.formKind === "org_rename") {
    if (!input.orgNameAfter?.trim()) return "組織名称の「追加・変更後」を入力してください。";
    return null;
  }

  if (!input.effectiveDate) return "適用日を入力してください。";
  if (input.orderDate && input.effectiveDate && input.orderDate > input.effectiveDate) {
    return "適用日が発令日より前になっています。";
  }
  if (input.limitedFrom && input.limitedTo && input.limitedFrom > input.limitedTo) {
    return "期間限定の開始日が終了日より後になっています。";
  }
  // 単身赴任事由は「異動後の赴任形態が単身赴任」のときだけ意味を持つ
  if (input.singleReasons.length > 0 && input.assignmentAfter !== "単身赴任") {
    return "単身赴任事由は、異動後の赴任形態が「単身赴任」のときだけ選べます。";
  }
  // 退職・兼務解除以外は「異動後」が何か1つは変わっているはず
  const changesNothing =
    input.kind !== "taishoku" &&
    input.kind !== "kenmu_kaijo" &&
    !input.toOrgUnitId &&
    !input.toPosition &&
    !input.toDuty &&
    !input.toGrade;
  if (changesNothing) return "異動後の所属・役職・職務・等級のいずれかを入力してください。";
  return null;
}

/**
 * 年度ではなく暦年で採番する（"J26-001"）。
 * 同時実行でも番号が重ならないよう、カウンタ行を UPDATE ... RETURNING で確保する。
 */
async function nextTransferNo(year: number): Promise<string> {
  const sql = getSql();
  await sql`INSERT INTO jinji_counters (year, seq) VALUES (${year}, 0) ON CONFLICT (year) DO NOTHING`;
  const rows = await sql`
    UPDATE jinji_counters SET seq = seq + 1 WHERE year = ${year} RETURNING seq`;
  return buildTransferNo(year, rows[0].seq as number);
}

/**
 * 異動申請を作成する。承認欄（捺印枠）も同時に用意する。
 * 「異動前」の値が空なら、申請時点の人事マスターの値を自動で埋める
 * （帳票の「現」欄が空だと申請書として成立しないため）。
 */
export async function createTransfer(
  input: TransferInput,
  draftedBy: string,
  draftedName: string,
): Promise<string> {
  await ensureSchema();
  const sql = getSql();

  const emp = await sql`
    SELECT org_unit_id, position_name, duty_name, grade
    FROM jinji_employees WHERE id = ${input.employeeId} LIMIT 1`;
  if (emp.length === 0) throw new Error("対象者が見つかりません。");
  const e = emp[0];

  const fromOrgUnitId = input.fromOrgUnitId ?? (e.org_unit_id as string | null) ?? null;
  const fromPosition = input.fromPosition ?? (e.position_name as string | null) ?? null;
  const fromDuty = input.fromDuty ?? (e.duty_name as string | null) ?? null;
  const fromGrade = input.fromGrade ?? (e.grade as string | null) ?? null;

  const year = Number((input.effectiveDate ?? new Date().toISOString()).slice(0, 4));
  const transferNo = await nextTransferNo(year);

  const rows = await sql`
    INSERT INTO jinji_transfers
      (transfer_no, employee_id, kind, from_org_unit_id, to_org_unit_id,
       from_position, to_position, from_duty, to_duty, from_grade, to_grade,
       order_date, effective_date, reason, remarks, status, drafted_by, drafted_name,
       form_kind, form_date, arrival_date, limited_from, limited_to, dept_agreement,
       org_name_before, org_name_after, relocation, housing_before, housing_after,
       assignment_before, assignment_after, single_reasons, mobile, mobile_after,
       company_car, company_car_after, company_car_other, parking, commute_change,
       explained_agreed, successor_checked, system_dept_code, system_dept_name)
    VALUES (${transferNo}, ${input.employeeId}, ${input.kind}, ${fromOrgUnitId}, ${input.toOrgUnitId},
            ${fromPosition}, ${input.toPosition}, ${fromDuty}, ${input.toDuty},
            ${fromGrade}, ${input.toGrade},
            ${input.orderDate}, ${input.effectiveDate}, ${input.reason}, ${input.remarks},
            'draft', ${draftedBy}, ${draftedName},
            ${input.formKind}, ${input.formDate}, ${input.arrivalDate},
            ${input.limitedFrom}, ${input.limitedTo}, ${input.deptAgreement},
            ${input.orgNameBefore}, ${input.orgNameAfter}, ${input.relocation},
            ${input.housingBefore}, ${input.housingAfter},
            ${input.assignmentBefore}, ${input.assignmentAfter},
            ${JSON.stringify(input.singleReasons)}::jsonb, ${input.mobile}, ${input.mobileAfter},
            ${input.companyCar}, ${input.companyCarAfter}, ${input.companyCarOther},
            ${input.parking}, ${input.commuteChange},
            ${input.explainedAgreed}, ${input.successorChecked},
            ${input.systemDeptCode}, ${input.systemDeptName})
    RETURNING id`;
  const id = rows[0].id as string;

  for (let i = 0; i < TRANSFER_APPROVAL_SLOTS.length; i++) {
    const s = TRANSFER_APPROVAL_SLOTS[i];
    await sql`
      INSERT INTO jinji_transfer_approvals (transfer_id, slot, seq)
      VALUES (${id}, ${s.slot}, ${i})
      ON CONFLICT (transfer_id, slot) DO NOTHING`;
  }
  return id;
}

/** 起案中・差戻の申請だけ編集できる（承認後に内容が変わると帳票と実態がずれるため）。 */
export async function updateTransfer(id: string, input: TransferInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_transfers WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  const status = normalizeTransferStatus(cur[0].status);
  if (status !== "draft" && status !== "rejected") {
    throw new Error("申請中・承認済みの申請書は編集できません。差し戻してから修正してください。");
  }
  await sql`
    UPDATE jinji_transfers SET
      employee_id = ${input.employeeId},
      kind = ${input.kind},
      from_org_unit_id = ${input.fromOrgUnitId},
      to_org_unit_id = ${input.toOrgUnitId},
      from_position = ${input.fromPosition},
      to_position = ${input.toPosition},
      from_duty = ${input.fromDuty},
      to_duty = ${input.toDuty},
      from_grade = ${input.fromGrade},
      to_grade = ${input.toGrade},
      order_date = ${input.orderDate},
      effective_date = ${input.effectiveDate},
      reason = ${input.reason},
      remarks = ${input.remarks},
      form_kind = ${input.formKind},
      form_date = ${input.formDate},
      arrival_date = ${input.arrivalDate},
      limited_from = ${input.limitedFrom},
      limited_to = ${input.limitedTo},
      dept_agreement = ${input.deptAgreement},
      org_name_before = ${input.orgNameBefore},
      org_name_after = ${input.orgNameAfter},
      relocation = ${input.relocation},
      housing_before = ${input.housingBefore},
      housing_after = ${input.housingAfter},
      assignment_before = ${input.assignmentBefore},
      assignment_after = ${input.assignmentAfter},
      single_reasons = ${JSON.stringify(input.singleReasons)}::jsonb,
      mobile = ${input.mobile},
      mobile_after = ${input.mobileAfter},
      company_car = ${input.companyCar},
      company_car_after = ${input.companyCarAfter},
      company_car_other = ${input.companyCarOther},
      parking = ${input.parking},
      commute_change = ${input.commuteChange},
      explained_agreed = ${input.explainedAgreed},
      successor_checked = ${input.successorChecked},
      system_dept_code = ${input.systemDeptCode},
      system_dept_name = ${input.systemDeptName},
      updated_at = NOW()
    WHERE id = ${id}`;
}

export async function deleteTransfer(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_transfers WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) return;
  if (normalizeTransferStatus(cur[0].status) === "issued") {
    throw new Error("発令済みの申請書は削除できません（人事マスターへ反映済みのため）。");
  }
  await sql`DELETE FROM jinji_transfers WHERE id = ${id}`;
}

// ===== 申請・承認 =====

/** 起案中／差戻 → 申請中。承認欄はすべて未処理に戻す。 */
export async function submitTransfer(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_transfers WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  const status = normalizeTransferStatus(cur[0].status);
  if (status !== "draft" && status !== "rejected") {
    throw new Error("この申請書は既に申請済みです。");
  }
  await sql.transaction([
    sql`UPDATE jinji_transfers SET status = 'submitted', updated_at = NOW() WHERE id = ${id}`,
    sql`
      UPDATE jinji_transfer_approvals
      SET decision = 'pending', decided_at = NULL, approver_login_id = NULL,
          approver_name = NULL, comment = NULL
      WHERE transfer_id = ${id}`,
  ]);
}

/**
 * 承認欄に押印する。
 *
 * - 1枠でも差戻があれば申請全体が差戻に戻る
 * - 全枠が承認になったら申請全体が承認済みになる
 * 枠の順序は強制しない（紙の回覧と同じく、揃った時点で成立とする）。
 */
export async function decideApproval(
  transferId: string,
  slot: TransferApprovalSlot,
  decision: Exclude<ApprovalDecision, "pending">,
  approverLoginId: string,
  approverName: string,
  comment: string | null,
): Promise<TransferStatus> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status FROM jinji_transfers WHERE id = ${transferId} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  if (normalizeTransferStatus(cur[0].status) !== "submitted") {
    throw new Error("申請中の申請書だけが承認・差戻できます。");
  }

  await sql`
    UPDATE jinji_transfer_approvals
    SET decision = ${decision}, decided_at = NOW(),
        approver_login_id = ${approverLoginId}, approver_name = ${approverName},
        comment = ${comment}
    WHERE transfer_id = ${transferId} AND slot = ${slot}`;

  const rows = await sql`
    SELECT decision FROM jinji_transfer_approvals WHERE transfer_id = ${transferId}`;
  const decisions = rows.map((r) => r.decision as ApprovalDecision);
  let next: TransferStatus = "submitted";
  if (decisions.includes("rejected")) next = "rejected";
  else if (decisions.length > 0 && decisions.every((d) => d === "approved")) next = "approved";

  if (next !== "submitted") {
    await sql`UPDATE jinji_transfers SET status = ${next}, updated_at = NOW() WHERE id = ${transferId}`;
  }
  return next;
}

/**
 * 発令適用。承認済みの申請の内容を人事マスターへ反映し、発令済みにする。
 *
 * 反映と状態更新は1トランザクションで行う。片方だけ通ると
 * 「発令済みなのに所属が変わっていない」という最も困る状態になるため。
 * 入力が空の項目は現状維持（部分的な異動＝役職だけ変える等に対応）。
 */
export async function applyTransfer(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM jinji_transfers WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) throw new Error("対象が見つかりません。");
  const t = rows[0];
  const status = normalizeTransferStatus(t.status);
  if (status === "issued") throw new Error("この申請書は既に発令済みです。");
  if (status !== "approved") throw new Error("承認済みの申請書だけが発令できます。");

  const kind = normalizeTransferKind(t.kind);
  const effectiveDate = toISODate(t.effective_date);

  // 退職の異動は在籍状態も落とす。それ以外は在籍状態を触らない。
  const retire = kind === "taishoku";

  await sql.transaction([
    sql`
      UPDATE jinji_employees SET
        org_unit_id   = COALESCE(${t.to_org_unit_id}, org_unit_id),
        position_name = COALESCE(${t.to_position}, position_name),
        duty_name     = COALESCE(${t.to_duty}, duty_name),
        grade         = COALESCE(${t.to_grade}, grade),
        status        = CASE WHEN ${retire} THEN 'retired' ELSE status END,
        retire_date   = CASE WHEN ${retire} THEN ${effectiveDate}::date ELSE retire_date END,
        updated_at    = NOW()
      WHERE id = ${t.employee_id}`,
    sql`
      UPDATE jinji_transfers SET status = 'issued', applied_at = NOW(), updated_at = NOW()
      WHERE id = ${id}`,
  ]);
}

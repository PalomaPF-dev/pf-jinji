import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 異動案（組織図の上で編成する下書き）。
 *
 * 組織図でドラッグして人を動かした結果は、**その場では人事マスターに書かない**。
 * 所属の変更は異動申請書（J-426）を通すのが正で、直接書き換えると履歴も帳票も残らない。
 * ここには案として溜め、確定したときに対象者ぶんの申請書を起こす。
 */

/** 帳票の凡例に合わせた印。 */
export type PlanMark = "promo_both" | "promo_duty" | "move";

export const PLAN_MARK_LABEL: Record<PlanMark, string> = {
  promo_both: "昇格（職務・役職）",
  promo_duty: "昇格（職務）",
  move: "所属移動",
};

/** 組織図に打つ記号。実物の凡例と同じ字を使う。 */
export const PLAN_MARK_SIGN: Record<PlanMark, string> = {
  promo_both: "◎",
  promo_duty: "○",
  move: "△",
};

export type OrgPlanStatus = "draft" | "applied";

export interface OrgPlan {
  id: string;
  name: string;
  baseDate: string | null;
  effectiveDate: string | null;
  status: OrgPlanStatus;
  note: string | null;
  createdBy: string | null;
  createdName: string | null;
  appliedAt: string | null;
  createdAt: string | null;
  moveCount: number;
}

export interface OrgPlanMove {
  id: string;
  planId: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  fromOrgUnitId: string | null;
  fromOrgUnitName: string | null;
  toOrgUnitId: string | null;
  toOrgUnitName: string | null;
  fromPosition: string | null;
  toPosition: string | null;
  fromDuty: string | null;
  toDuty: string | null;
  mark: PlanMark;
  transferId: string | null;
}

function normalizeMark(v: unknown): PlanMark {
  return v === "promo_both" || v === "promo_duty" ? v : "move";
}

/**
 * 印を決める。役職も職務も変われば◎、職務だけなら○、それ以外は△。
 * 実物の凡例（◎昇格(職務・役職) / ○昇格(職務) / △所属移動）に合わせている。
 */
export function decideMark(input: {
  fromPosition: string | null;
  toPosition: string | null;
  fromDuty: string | null;
  toDuty: string | null;
}): PlanMark {
  const norm = (v: string | null) => (v ?? "").trim();
  const positionChanged = norm(input.toPosition) !== "" && norm(input.toPosition) !== norm(input.fromPosition);
  const dutyChanged = norm(input.toDuty) !== "" && norm(input.toDuty) !== norm(input.fromDuty);
  if (positionChanged && dutyChanged) return "promo_both";
  if (dutyChanged) return "promo_duty";
  return "move";
}

function mapPlan(r: any): OrgPlan {
  return {
    id: r.id,
    name: r.name,
    baseDate: toISODate(r.base_date),
    effectiveDate: toISODate(r.effective_date),
    status: r.status === "applied" ? "applied" : "draft",
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdName: r.created_name ?? null,
    appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    moveCount: Number(r.move_count ?? 0),
  };
}

function mapMove(r: any): OrgPlanMove {
  return {
    id: r.id,
    planId: r.plan_id,
    employeeId: r.employee_id,
    employeeNo: r.employee_no ?? "",
    employeeName: r.employee_name ?? "",
    fromOrgUnitId: r.from_org_unit_id ?? null,
    fromOrgUnitName: r.from_org_name ?? null,
    toOrgUnitId: r.to_org_unit_id ?? null,
    toOrgUnitName: r.to_org_name ?? null,
    fromPosition: r.from_position ?? null,
    toPosition: r.to_position ?? null,
    fromDuty: r.from_duty ?? null,
    toDuty: r.to_duty ?? null,
    mark: normalizeMark(r.mark),
    transferId: r.transfer_id ?? null,
  };
}

// ===== 取得 =====

export async function listOrgPlans(): Promise<OrgPlan[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT p.*, count(m.id)::int AS move_count
    FROM jinji_org_plans p
    LEFT JOIN jinji_org_plan_moves m ON m.plan_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC`;
  return rows.map(mapPlan);
}

export async function getOrgPlan(id: string): Promise<OrgPlan | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT p.*, count(m.id)::int AS move_count
    FROM jinji_org_plans p
    LEFT JOIN jinji_org_plan_moves m ON m.plan_id = p.id
    WHERE p.id = ${id}
    GROUP BY p.id`;
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function listPlanMoves(planId: string): Promise<OrgPlanMove[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT m.*, e.employee_no, e.name AS employee_name,
           fo.name AS from_org_name, too.name AS to_org_name
    FROM jinji_org_plan_moves m
    JOIN jinji_employees e ON e.id = m.employee_id
    LEFT JOIN jinji_org_units fo ON fo.id = m.from_org_unit_id
    LEFT JOIN jinji_org_units too ON too.id = m.to_org_unit_id
    WHERE m.plan_id = ${planId}
    ORDER BY too.sort NULLS LAST, e.name_kana NULLS LAST, e.employee_no`;
  return rows.map(mapMove);
}

// ===== 作成・編集 =====

export async function createOrgPlan(
  name: string,
  baseDate: string | null,
  effectiveDate: string | null,
  createdBy: string,
  createdName: string,
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO jinji_org_plans (name, base_date, effective_date, created_by, created_name)
    VALUES (${name}, ${baseDate}, ${effectiveDate}, ${createdBy}, ${createdName})
    RETURNING id`;
  return rows[0].id as string;
}

/**
 * 組織図で1人動かした結果を案に記録する（同じ人を何度動かしても1行に保つ）。
 *
 * 「現」は**人事マスターの現在値**を毎回読み直して入れる。案の中で動かし直したときに
 * 中間状態が「現」になってしまうと、発令のときに実態とずれるため。
 * 元の所属へ戻したら、その人の行は消す（変化なしを案に残さない）。
 */
export async function setPlanMove(
  planId: string,
  employeeId: string,
  toOrgUnitId: string | null,
  overrides?: { toPosition?: string | null; toDuty?: string | null },
): Promise<{ removed: boolean }> {
  await ensureSchema();
  const sql = getSql();

  const plan = await sql`SELECT status FROM jinji_org_plans WHERE id = ${planId} LIMIT 1`;
  if (plan.length === 0) throw new Error("異動案が見つかりません。");
  if (plan[0].status === "applied") throw new Error("確定済みの案は編集できません。");

  const emp = await sql`
    SELECT id, org_unit_id, position_name, duty_name
    FROM jinji_employees WHERE id = ${employeeId} LIMIT 1`;
  if (emp.length === 0) throw new Error("対象者が見つかりません。");
  const e = emp[0];

  const fromOrgUnitId = (e.org_unit_id as string | null) ?? null;
  const fromPosition = (e.position_name as string | null) ?? null;
  const fromDuty = (e.duty_name as string | null) ?? null;
  const toPosition = overrides?.toPosition ?? null;
  const toDuty = overrides?.toDuty ?? null;

  const sameOrg = (toOrgUnitId ?? null) === fromOrgUnitId;
  const noChange = sameOrg && !toPosition && !toDuty;
  if (noChange) {
    await sql`DELETE FROM jinji_org_plan_moves WHERE plan_id = ${planId} AND employee_id = ${employeeId}`;
    return { removed: true };
  }

  const mark = decideMark({ fromPosition, toPosition, fromDuty, toDuty });
  await sql`
    INSERT INTO jinji_org_plan_moves
      (plan_id, employee_id, from_org_unit_id, to_org_unit_id,
       from_position, to_position, from_duty, to_duty, mark)
    VALUES (${planId}, ${employeeId}, ${fromOrgUnitId}, ${toOrgUnitId},
            ${fromPosition}, ${toPosition}, ${fromDuty}, ${toDuty}, ${mark})
    ON CONFLICT (plan_id, employee_id) DO UPDATE SET
      from_org_unit_id = EXCLUDED.from_org_unit_id,
      to_org_unit_id   = EXCLUDED.to_org_unit_id,
      from_position    = EXCLUDED.from_position,
      to_position      = EXCLUDED.to_position,
      from_duty        = EXCLUDED.from_duty,
      to_duty          = EXCLUDED.to_duty,
      mark             = EXCLUDED.mark`;
  return { removed: false };
}

export async function removePlanMove(planId: string, employeeId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM jinji_org_plan_moves WHERE plan_id = ${planId} AND employee_id = ${employeeId}`;
}

export async function deleteOrgPlan(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT status FROM jinji_org_plans WHERE id = ${id} LIMIT 1`;
  if (rows.length > 0 && rows[0].status === "applied") {
    throw new Error("確定済みの案は削除できません。");
  }
  await sql`DELETE FROM jinji_org_plans WHERE id = ${id}`;
}

export async function updateOrgPlan(
  id: string,
  fields: { name: string; baseDate: string | null; effectiveDate: string | null; note: string | null },
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE jinji_org_plans
    SET name = ${fields.name}, base_date = ${fields.baseDate},
        effective_date = ${fields.effectiveDate}, note = ${fields.note}, updated_at = NOW()
    WHERE id = ${id} AND status = 'draft'`;
}

/** 案の状態を確定済みにする（申請書を起こしたあと）。 */
export async function markPlanApplied(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE jinji_org_plans SET status = 'applied', applied_at = NOW(), updated_at = NOW() WHERE id = ${id}`;
}

/** 起こした申請書のIDを動きに紐づける。 */
export async function linkMoveTransfer(moveId: string, transferId: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE jinji_org_plan_moves SET transfer_id = ${transferId} WHERE id = ${moveId}`;
}

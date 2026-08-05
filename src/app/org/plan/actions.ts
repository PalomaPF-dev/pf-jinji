"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertJinjiSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  createOrgPlan,
  deleteOrgPlan,
  getOrgPlan,
  linkMoveTransfer,
  listPlanMoves,
  markPlanApplied,
  removePlanMove,
  setPlanMove,
  updateOrgPlan,
} from "@/lib/orgPlans";
import { createTransfer } from "@/lib/transfers";
import { todayJST } from "@/lib/dates";

/**
 * 異動案（組織図の上の編成）の Server Action。
 *
 * 組織図で人を動かしても人事マスターは書き換えない。案に溜めて、確定したときに
 * 対象者ぶんの異動申請書（J-426）を起案中で作る。所属の変更は申請書を通すのが正で、
 * 直接書き換えると履歴も帳票も残らないため。
 */

export interface OrgPlanActionState {
  error?: string;
  message?: string;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

function nullable(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

export async function createOrgPlanAction(
  _prev: OrgPlanActionState,
  form: FormData,
): Promise<OrgPlanActionState> {
  const s = await assertJinjiSession();
  const name = str(form, "name") || `${todayJST()} の異動案`;
  let id: string;
  try {
    id = await createOrgPlan(
      name,
      nullable(form, "baseDate") ?? todayJST(),
      nullable(form, "effectiveDate"),
      s.grant.loginId,
      s.grant.name,
    );
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_org",
    targetType: "org_plan",
    targetId: id,
    targetLabel: name,
    detail: { event: "create_plan" },
  });
  revalidatePath("/org/plan");
  redirect(`/org/plan/${id}`);
}

/**
 * 組織図で1人動かす（ドラッグ&ドロップの受け口）。
 * 元の所属へ戻したときは案から取り除く。
 */
export async function movePersonAction(
  _prev: OrgPlanActionState,
  form: FormData,
): Promise<OrgPlanActionState> {
  await assertJinjiSession();
  const planId = str(form, "planId");
  const employeeId = str(form, "employeeId");
  const toOrgUnitId = nullable(form, "toOrgUnitId");
  if (!planId || !employeeId) return { error: "対象が指定されていません。" };

  try {
    const r = await setPlanMove(planId, employeeId, toOrgUnitId, {
      toPosition: nullable(form, "toPosition"),
      toDuty: nullable(form, "toDuty"),
    });
    revalidatePath(`/org/plan/${planId}`);
    return { message: r.removed ? "元の所属に戻しました。" : "案に反映しました。" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeMoveAction(
  _prev: OrgPlanActionState,
  form: FormData,
): Promise<OrgPlanActionState> {
  await assertJinjiSession();
  const planId = str(form, "planId");
  const employeeId = str(form, "employeeId");
  try {
    await removePlanMove(planId, employeeId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/org/plan/${planId}`);
  return { message: "案から取り消しました。" };
}

export async function updateOrgPlanAction(
  _prev: OrgPlanActionState,
  form: FormData,
): Promise<OrgPlanActionState> {
  await assertJinjiSession();
  const id = str(form, "id");
  try {
    await updateOrgPlan(id, {
      name: str(form, "name"),
      baseDate: nullable(form, "baseDate"),
      effectiveDate: nullable(form, "effectiveDate"),
      note: nullable(form, "note"),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/org/plan/${id}`);
  return { message: "保存しました。" };
}

export async function deleteOrgPlanAction(
  _prev: OrgPlanActionState,
  form: FormData,
): Promise<OrgPlanActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const plan = await getOrgPlan(id);
  try {
    await deleteOrgPlan(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_org",
    targetType: "org_plan",
    targetId: id,
    targetLabel: plan?.name ?? id,
    detail: { event: "delete_plan" },
  });
  revalidatePath("/org/plan");
  redirect("/org/plan");
}

/**
 * 案を確定して、動かした人ぶんの異動申請書を起案中で作る。
 *
 * ここでも人事マスターには書かない。各申請書を申請 → 承認 → 発令まで通したときに
 * 初めて反映される（既存の流れをそのまま使う）。
 */
export async function issueTransfersAction(
  _prev: OrgPlanActionState,
  form: FormData,
): Promise<OrgPlanActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const plan = await getOrgPlan(id);
  if (!plan) return { error: "異動案が見つかりません。" };
  if (plan.status === "applied") return { error: "この案はすでに申請書を作成済みです。" };
  if (!plan.effectiveDate) return { error: "発令予定日を入れてから確定してください。" };

  const moves = await listPlanMoves(id);
  if (moves.length === 0) return { error: "動かした人が居ません。" };

  let created = 0;
  const failures: string[] = [];
  for (const m of moves) {
    if (m.transferId) continue; // 作り直しを避ける
    try {
      const transferId = await createTransfer(
        {
          employeeId: m.employeeId,
          kind: m.mark === "move" ? "haichi" : "shoshin",
          fromOrgUnitId: m.fromOrgUnitId,
          toOrgUnitId: m.toOrgUnitId,
          fromPosition: m.fromPosition,
          toPosition: m.toPosition,
          fromDuty: m.fromDuty,
          toDuty: m.toDuty,
          fromGrade: null,
          toGrade: null,
          orderDate: null,
          effectiveDate: plan.effectiveDate,
          reason: `${plan.name} による異動`,
          remarks: null,
          formKind: "transfer",
          formDate: null,
          arrivalDate: null,
          limitedFrom: null,
          limitedTo: null,
          deptAgreement: null,
          orgNameBefore: null,
          orgNameAfter: null,
          relocation: null,
          housingBefore: null,
          housingAfter: null,
          assignmentBefore: null,
          assignmentAfter: null,
          singleReasons: [],
          mobile: null,
          mobileAfter: null,
          companyCar: null,
          companyCarAfter: null,
          companyCarOther: null,
          parking: null,
          commuteChange: null,
          explainedAgreed: false,
          successorChecked: false,
          systemDeptCode: null,
          systemDeptName: null,
        },
        s.grant.loginId,
        s.grant.name,
      );
      await linkMoveTransfer(m.id, transferId);
      created++;
    } catch (e) {
      failures.push(`${m.employeeName}: ${(e as Error).message}`);
    }
  }

  if (created > 0) await markPlanApplied(id);

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "create_transfer",
    targetType: "org_plan",
    targetId: id,
    targetLabel: plan.name,
    detail: { event: "issue_from_plan", created, failed: failures.length },
  });
  revalidatePath("/org/plan");
  revalidatePath(`/org/plan/${id}`);
  revalidatePath("/transfers");

  if (failures.length > 0) {
    return {
      error: `${created} 件は作成しましたが、${failures.length} 件は失敗しました: ${failures.slice(0, 3).join(" / ")}`,
    };
  }
  return { message: `異動申請書を ${created} 件作成しました（起案中）。` };
}

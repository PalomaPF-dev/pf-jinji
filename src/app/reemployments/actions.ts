"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertJinjiSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  createReemployment,
  decideReemploymentApproval,
  deleteReemployment,
  setReemploymentAssignee,
  getReemployment,
  submitReemployment,
  updateReemployment,
  validateReemployment,
  type ReemploymentInput,
} from "@/lib/reemployments";
import {
  REEMPLOYMENT_APPROVAL_SLOTS,
  REEMPLOYMENT_DUTY_COUNT,
  REEMPLOYMENT_REASON_COUNT,
  REEMPLOYMENT_TYPES,
  type ReemploymentApprovalSlot,
} from "@/lib/types";
import { formValues, type FormValues } from "@/lib/formState";

/**
 * 継続雇用申請書（指定帳票 J-456）の Server Action。
 * 異動申請と同じ流儀（起案 → 申請 → 承認/差戻）で揃えてある。
 */

export interface ReemploymentActionState {
  error?: string;
  message?: string;
  /** 入力エラーで差し戻すときの送信値。React 19 のフォーム自動リセット対策 */
  values?: FormValues;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

function nullable(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

function numberOrNull(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** duties0..2 / reasons0..3 のように連番の name で受け取る。 */
function list(form: FormData, prefix: string, size: number): string[] {
  return Array.from({ length: size }, (_, i) => str(form, `${prefix}${i}`));
}

function readInput(form: FormData): ReemploymentInput {
  const employmentType = str(form, "employmentType");
  return {
    employeeId: str(form, "employeeId"),
    orgUnitName: nullable(form, "orgUnitName"),
    currentEmploymentType: nullable(form, "currentEmploymentType"),
    contractEndDate: nullable(form, "contractEndDate"),
    // 想定外の値が帳票に出ないよう、選択肢に無い雇用形態は落とす
    employmentType: (REEMPLOYMENT_TYPES as readonly string[]).includes(employmentType)
      ? employmentType
      : null,
    periodFrom: nullable(form, "periodFrom"),
    periodTo: nullable(form, "periodTo"),
    workPlace: nullable(form, "workPlace"),
    daysPerWeek: numberOrNull(form, "daysPerWeek"),
    workStart: nullable(form, "workStart"),
    workEnd: nullable(form, "workEnd"),
    breakHours: numberOrNull(form, "breakHours"),
    duties: list(form, "duty", REEMPLOYMENT_DUTY_COUNT),
    reasons: list(form, "reason", REEMPLOYMENT_REASON_COUNT),
    compliance: nullable(form, "compliance"),
    conclusion: nullable(form, "conclusion"),
    formDate: nullable(form, "formDate"),
  };
}

export async function createReemploymentAction(
  _prev: ReemploymentActionState,
  form: FormData,
): Promise<ReemploymentActionState> {
  const s = await assertJinjiSession();
  const input = readInput(form);
  const problem = validateReemployment(input);
  if (problem) return { error: problem, values: formValues(form) };

  let id: string;
  try {
    id = await createReemployment(input, s.grant.loginId, s.grant.name);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  const r = await getReemployment(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "create_reemployment",
    targetType: "reemployment",
    targetId: id,
    targetLabel: r ? `${r.docNo} ${r.employeeName}` : id,
  });
  revalidatePath("/reemployments");
  redirect(`/reemployments/${id}`);
}

export async function updateReemploymentAction(
  _prev: ReemploymentActionState,
  form: FormData,
): Promise<ReemploymentActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。", values: formValues(form) };
  const input = readInput(form);
  const problem = validateReemployment(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await updateReemployment(id, input);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  const r = await getReemployment(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_reemployment",
    targetType: "reemployment",
    targetId: id,
    targetLabel: r ? `${r.docNo} ${r.employeeName}` : id,
  });
  revalidatePath("/reemployments");
  revalidatePath(`/reemployments/${id}`);
  redirect(`/reemployments/${id}`);
}

/** 起案中／差戻 → 申請中。 */
export async function submitReemploymentAction(
  _prev: ReemploymentActionState,
  form: FormData,
): Promise<ReemploymentActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  try {
    await submitReemployment(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const r = await getReemployment(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_reemployment",
    targetType: "reemployment",
    targetId: id,
    targetLabel: r ? `${r.docNo} ${r.employeeName}` : id,
    detail: { event: "submit" },
  });
  revalidatePath("/reemployments");
  revalidatePath(`/reemployments/${id}`);
  return { message: "申請しました。" };
}

/** 承認欄への押印（承認・差戻）。 */
export async function decideReemploymentApprovalAction(
  _prev: ReemploymentActionState,
  form: FormData,
): Promise<ReemploymentActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const slot = str(form, "slot") as ReemploymentApprovalSlot;
  const decision = str(form, "decision");
  if (!REEMPLOYMENT_APPROVAL_SLOTS.some((x) => x.slot === slot)) {
    return { error: "承認欄の指定が不正です。" };
  }
  if (decision !== "approved" && decision !== "rejected") {
    return { error: "承認・差戻のいずれかを選んでください。" };
  }

  try {
    await decideReemploymentApproval(
      id,
      slot,
      decision,
      s.grant.loginId,
      s.grant.name,
      str(form, "comment") || null,
      s.grant.isOwner,
    );
  } catch (e) {
    return { error: (e as Error).message };
  }

  const r = await getReemployment(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "approve_reemployment",
    targetType: "reemployment",
    targetId: id,
    targetLabel: r ? `${r.docNo} ${r.employeeName}` : id,
    detail: { slot, decision },
  });
  revalidatePath("/reemployments");
  revalidatePath(`/reemployments/${id}`);
  return { message: decision === "approved" ? "承認しました。" : "差し戻しました。" };
}

export async function deleteReemploymentAction(
  _prev: ReemploymentActionState,
  form: FormData,
): Promise<ReemploymentActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const r = await getReemployment(id);
  try {
    await deleteReemployment(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_reemployment",
    targetType: "reemployment",
    targetId: id,
    targetLabel: r ? `${r.docNo} ${r.employeeName}` : id,
    detail: { event: "delete" },
  });
  revalidatePath("/reemployments");
  redirect("/reemployments");
}


/**
 * 承認欄の担当者を決める。
 * 部門長は申請部署から自動で入るが、役員などは社員番号で指定する。
 */
export async function setReemploymentApproverAction(
  _prev: ReemploymentActionState,
  form: FormData,
): Promise<ReemploymentActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const slot = str(form, "slot");
  if (!REEMPLOYMENT_APPROVAL_SLOTS.some((x) => x.slot === slot)) {
    return { error: "承認欄の指定が不正です。" };
  }
  const r = await getReemployment(id);
  if (!r) return { error: "対象が見つかりません。" };

  let set: { name: string } | null;
  try {
    set = await setReemploymentAssignee(id, slot, str(form, "employeeNo"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_reemployment",
    targetType: "reemployment",
    targetId: id,
    targetLabel: `${r.docNo} ${r.employeeName}`,
    detail: { slot, assignee: set?.name ?? null },
  });
  revalidatePath(`/reemployments/${id}`);
  return { message: set ? `${set.name} さんを担当に設定しました。` : "担当を外しました。" };
}

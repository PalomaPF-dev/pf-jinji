"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertJinjiSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  applyTransfer,
  createTransfer,
  decideApproval,
  deleteTransfer,
  getTransfer,
  submitTransfer,
  updateTransfer,
  validateTransfer,
  type TransferInput,
} from "@/lib/transfers";
import { TRANSFER_APPROVAL_SLOTS, normalizeTransferKind, type TransferApprovalSlot } from "@/lib/types";
import { formValues, type FormValues } from "@/lib/formState";

export interface TransferActionState {
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

function readInput(form: FormData): TransferInput {
  return {
    employeeId: str(form, "employeeId"),
    kind: normalizeTransferKind(str(form, "kind")),
    fromOrgUnitId: nullable(form, "fromOrgUnitId"),
    toOrgUnitId: nullable(form, "toOrgUnitId"),
    fromPosition: nullable(form, "fromPosition"),
    toPosition: nullable(form, "toPosition"),
    fromDuty: nullable(form, "fromDuty"),
    toDuty: nullable(form, "toDuty"),
    fromGrade: nullable(form, "fromGrade"),
    toGrade: nullable(form, "toGrade"),
    orderDate: nullable(form, "orderDate"),
    effectiveDate: nullable(form, "effectiveDate"),
    reason: nullable(form, "reason"),
    remarks: nullable(form, "remarks"),
  };
}

export async function createTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const input = readInput(form);
  const problem = validateTransfer(input);
  if (problem) return { error: problem, values: formValues(form) };

  let id: string;
  try {
    id = await createTransfer(input, s.grant.loginId, s.grant.name);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  const t = await getTransfer(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "create_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: t ? `${t.transferNo} ${t.employeeName}` : id,
  });
  revalidatePath("/transfers");
  redirect(`/transfers/${id}`);
}

export async function updateTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。", values: formValues(form) };
  const input = readInput(form);
  const problem = validateTransfer(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await updateTransfer(id, input);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  const t = await getTransfer(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: t ? `${t.transferNo} ${t.employeeName}` : id,
  });
  revalidatePath("/transfers");
  revalidatePath(`/transfers/${id}`);
  redirect(`/transfers/${id}`);
}

/** 起案中／差戻 → 申請中。 */
export async function submitTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  try {
    await submitTransfer(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const t = await getTransfer(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: t ? `${t.transferNo} ${t.employeeName}` : id,
    detail: { event: "submit" },
  });
  revalidatePath("/transfers");
  revalidatePath(`/transfers/${id}`);
  return { message: "申請しました。" };
}

/** 承認欄への押印（承認・差戻）。 */
export async function decideApprovalAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const slot = str(form, "slot") as TransferApprovalSlot;
  const decision = str(form, "decision");
  if (!TRANSFER_APPROVAL_SLOTS.some((x) => x.slot === slot)) {
    return { error: "承認欄の指定が不正です。" };
  }
  if (decision !== "approved" && decision !== "rejected") {
    return { error: "承認または差戻を指定してください。" };
  }

  let next: string;
  try {
    next = await decideApproval(id, slot, decision, s.grant.loginId, s.grant.name, nullable(form, "comment"));
  } catch (e) {
    return { error: (e as Error).message };
  }

  const t = await getTransfer(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "approve_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: t ? `${t.transferNo} ${t.employeeName}` : id,
    detail: { slot, decision, resultStatus: next },
  });
  revalidatePath("/transfers");
  revalidatePath(`/transfers/${id}`);
  return {
    message:
      decision === "approved"
        ? next === "approved"
          ? "承認しました。全員の承認が揃ったため、発令できます。"
          : "承認しました。"
        : "差し戻しました。",
  };
}

/**
 * 発令適用。人事マスターへ反映し、発令済みにする。
 * 戻せない操作なので、画面側で確認ダイアログを出している。
 */
export async function applyTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const before = await getTransfer(id);
  try {
    await applyTransfer(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "apply_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: before ? `${before.transferNo} ${before.employeeName}` : id,
    detail: {
      employeeId: before?.employeeId,
      toOrgUnit: before?.toOrgUnitName,
      toPosition: before?.toPosition,
      effectiveDate: before?.effectiveDate,
    },
  });
  revalidatePath("/transfers");
  revalidatePath(`/transfers/${id}`);
  revalidatePath("/employees");
  revalidatePath("/org");
  return { message: "発令し、人事マスターへ反映しました。" };
}

export async function deleteTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const before = await getTransfer(id);
  try {
    await deleteTransfer(id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: before ? `${before.transferNo} ${before.employeeName}` : id,
    detail: { event: "delete" },
  });
  revalidatePath("/transfers");
  redirect("/transfers");
}

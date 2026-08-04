"use server";

import { revalidatePath } from "next/cache";
import { assertJinjiSession, assertOwnerSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { formValues, type FormValues } from "@/lib/formState";
import {
  createQualification,
  createQualificationMaster,
  deleteQualification,
  deleteQualificationMaster,
  validateQualification,
  type QualificationInput,
} from "@/lib/qualifications";
import { getEmployee } from "@/lib/employees";
import { normalizeQualificationCategory } from "@/lib/types";

export interface QualificationActionState {
  error?: string;
  message?: string;
  values?: FormValues;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

function nullable(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

/** 保有資格の登録。 */
export async function createQualificationAction(
  _prev: QualificationActionState,
  form: FormData,
): Promise<QualificationActionState> {
  const s = await assertJinjiSession();
  const input: QualificationInput = {
    employeeId: str(form, "employeeId"),
    masterId: nullable(form, "masterId"),
    name: str(form, "name"),
    category: normalizeQualificationCategory(str(form, "category")),
    acquiredOn: nullable(form, "acquiredOn"),
    expiresOn: nullable(form, "expiresOn"),
    certificateNo: nullable(form, "certificateNo"),
    issuer: nullable(form, "issuer"),
    note: nullable(form, "note"),
  };
  const problem = validateQualification(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await createQualification(input);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  const emp = await getEmployee(input.employeeId);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_employee",
    targetType: "qualification",
    targetId: input.employeeId,
    targetLabel: emp ? `${emp.employeeNo} ${emp.name} / ${input.name}` : input.name,
  });
  revalidatePath("/qualifications");
  return { message: `「${input.name}」を登録しました。` };
}

export async function deleteQualificationAction(
  _prev: QualificationActionState,
  form: FormData,
): Promise<QualificationActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。" };
  await deleteQualification(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_employee",
    targetType: "qualification",
    targetId: id,
    targetLabel: str(form, "label") || id,
    detail: { event: "delete" },
  });
  revalidatePath("/qualifications");
  return { message: "削除しました。" };
}

/** 資格マスターの追加（設定画面）。マスターの増減は責任者のみ。 */
export async function createQualificationMasterAction(
  _prev: QualificationActionState,
  form: FormData,
): Promise<QualificationActionState> {
  const s = await assertOwnerSession();
  const code = str(form, "code");
  const name = str(form, "name");
  const renewalRequired = str(form, "renewalRequired") === "on";
  const renewalMonthsRaw = str(form, "renewalMonths");
  const renewalMonths = renewalMonthsRaw ? Number(renewalMonthsRaw) : null;

  if (!code || !/^[A-Za-z0-9_-]{1,20}$/.test(code)) {
    return { error: "資格コードは半角英数字とハイフン・アンダースコア（20文字以内）です。", values: formValues(form) };
  }
  if (!name) return { error: "資格名は必須です。", values: formValues(form) };
  if (renewalRequired && (!renewalMonths || renewalMonths <= 0)) {
    return { error: "更新が必要な資格は、更新間隔（月）を入力してください。", values: formValues(form) };
  }

  try {
    await createQualificationMaster({
      code,
      name,
      category: normalizeQualificationCategory(str(form, "category")),
      renewalRequired,
      renewalMonths: renewalRequired ? renewalMonths : null,
      sort: Number(str(form, "sort")) || 0,
    });
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? `資格コード ${code} は既に使われています。`
      : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_admin",
    targetType: "qualification_master",
    targetLabel: `${code} ${name}`,
  });
  revalidatePath("/settings");
  revalidatePath("/qualifications");
  return { message: `資格「${name}」を追加しました。` };
}

export async function deleteQualificationMasterAction(
  _prev: QualificationActionState,
  form: FormData,
): Promise<QualificationActionState> {
  const s = await assertOwnerSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。" };
  await deleteQualificationMaster(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_admin",
    targetType: "qualification_master",
    targetId: id,
    targetLabel: str(form, "label") || id,
    detail: { event: "delete" },
  });
  revalidatePath("/settings");
  revalidatePath("/qualifications");
  return { message: "資格マスターから削除しました（登録済みの取得実績は残ります）。" };
}

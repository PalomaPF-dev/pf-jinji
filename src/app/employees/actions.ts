"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertJinjiSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { parseCsvObjects } from "@/lib/csv";
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  importEmployeesCsv,
  updateEmployee,
  validateEmployee,
  type CsvImportResult,
  type EmployeeInput,
} from "@/lib/employees";
import { normalizeEmploymentStatus, type Gender } from "@/lib/types";
import { formValues, type FormValues } from "@/lib/formState";

export interface ActionState {
  error?: string;
  message?: string;
  /** 入力エラーで差し戻すときの送信値。React 19 のフォーム自動リセット対策 */
  values?: FormValues;
  /** CSV取込の結果（取込フォームのみ使う） */
  importResult?: CsvImportResult;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

function nullable(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

function readEmployeeInput(form: FormData): EmployeeInput {
  const genderRaw = str(form, "gender");
  return {
    employeeNo: str(form, "employeeNo"),
    name: str(form, "name"),
    nameKana: nullable(form, "nameKana"),
    gender: genderRaw === "male" || genderRaw === "female" || genderRaw === "other" ? (genderRaw as Gender) : null,
    birthDate: nullable(form, "birthDate"),
    hireDate: nullable(form, "hireDate"),
    employmentType: nullable(form, "employmentType"),
    orgUnitId: nullable(form, "orgUnitId"),
    positionName: nullable(form, "positionName"),
    dutyName: nullable(form, "dutyName"),
    grade: nullable(form, "grade"),
    status: normalizeEmploymentStatus(str(form, "status")),
    retireDate: nullable(form, "retireDate"),
    email: nullable(form, "email"),
    phone: nullable(form, "phone"),
    note: nullable(form, "note"),
  };
}

/** 社員の新規登録。成功したら社員カードへ遷移する。 */
export async function createEmployeeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await assertJinjiSession();
  const input = readEmployeeInput(form);
  const problem = validateEmployee(input);
  if (problem) return { error: problem, values: formValues(form) };

  let id: string;
  try {
    id = await createEmployee(input);
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? `社員番号 ${input.employeeNo} は既に登録されています。`
      : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "create_employee",
    targetType: "employee",
    targetId: id,
    targetLabel: `${input.employeeNo} ${input.name}`,
  });
  revalidatePath("/employees");
  redirect(`/employees/${id}`);
}

/** 社員情報の更新。 */
export async function updateEmployeeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。", values: formValues(form) };
  const input = readEmployeeInput(form);
  const problem = validateEmployee(input);
  if (problem) return { error: problem, values: formValues(form) };

  const before = await getEmployee(id);
  if (!before) return { error: "対象が見つかりません。" };

  try {
    await updateEmployee(id, input);
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? `社員番号 ${input.employeeNo} は既に登録されています。`
      : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_employee",
    targetType: "employee",
    targetId: id,
    targetLabel: `${input.employeeNo} ${input.name}`,
    detail: { statusBefore: before.status, statusAfter: input.status },
  });
  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}`);
}

/**
 * 社員の削除。
 * 給与・考課・異動申請・資格も併せて消えるため、退職の記録は status='retired' で残すのが正。
 */
export async function deleteEmployeeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const target = await getEmployee(id);
  if (!target) return { error: "対象が見つかりません。" };

  await deleteEmployee(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "delete_employee",
    targetType: "employee",
    targetId: id,
    targetLabel: `${target.employeeNo} ${target.name}`,
  });
  revalidatePath("/employees");
  redirect("/employees");
}

/** CSV取込。社員番号をキーに upsert し、行ごとの失敗は結果として返す。 */
export async function importEmployeesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await assertJinjiSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "CSVファイルを選んでください。" };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "ファイルが大きすぎます（5MBまで）。" };
  }

  let records: Record<string, string>[];
  try {
    records = parseCsvObjects(await file.text());
  } catch (e) {
    return { error: `CSVを読み取れませんでした: ${(e as Error).message}` };
  }
  if (records.length === 0) return { error: "データ行がありません。" };

  const result = await importEmployeesCsv(records);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_employee",
    targetType: "employee",
    targetLabel: "CSV取込",
    detail: { created: result.created, updated: result.updated, errorCount: result.errors.length },
  });
  revalidatePath("/employees");
  return {
    message: `取込しました（新規 ${result.created} 件 / 更新 ${result.updated} 件${
      result.errors.length ? ` / エラー ${result.errors.length} 件` : ""
    }）`,
    importResult: result,
  };
}

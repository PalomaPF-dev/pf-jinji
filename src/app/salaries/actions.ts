"use server";

import { revalidatePath } from "next/cache";
import { assertPayrollSession } from "@/lib/session";
import { readXlsx } from "@/lib/xlsx";
import {
  effectiveFromOfSheetName,
  findHeaderRow,
  importBonusMaster,
  looksLikeBonusMaster,
} from "@/lib/bonusImport";
import { recordAudit } from "@/lib/audit";
import { formValues, type FormValues } from "@/lib/formState";
import { createSalary, validateSalary, voidSalary, type SalaryInput } from "@/lib/salaries";
import { getEmployee } from "@/lib/employees";
import type { SalaryAllowance } from "@/lib/types";

export interface SalaryActionState {
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

/**
 * 手当は「名称/金額」の組を最大5つまで受け取る。
 * 名称が空の組は登録しない（欄が余っていても素通しできるように）。
 */
function readAllowances(form: FormData): SalaryAllowance[] {
  const out: SalaryAllowance[] = [];
  for (let i = 0; i < 5; i++) {
    const name = str(form, `allowanceName${i}`);
    const amountRaw = str(form, `allowanceAmount${i}`);
    if (!name && !amountRaw) continue;
    out.push({ name, amount: Number(amountRaw.replace(/,/g, "")) });
  }
  return out;
}

/** 給与改定の登録。基本給・考課は最も機微なので、更新は必ず監査ログに残す。 */
export async function createSalaryAction(
  _prev: SalaryActionState,
  form: FormData,
): Promise<SalaryActionState> {
  const s = await assertPayrollSession();
  const input: SalaryInput = {
    employeeId: str(form, "employeeId"),
    effectiveFrom: str(form, "effectiveFrom"),
    baseSalary: Number(str(form, "baseSalary").replace(/,/g, "")),
    allowances: readAllowances(form),
    grade: nullable(form, "grade"),
    step: nullable(form, "step"),
    revisionKind: str(form, "revisionKind") || "新規登録",
    reason: nullable(form, "reason"),
  };

  const problem = validateSalary(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await createSalary(input, s.grant.loginId, s.grant.name);
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? "同じ適用開始年月の改定が既に登録されています。"
      : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  const emp = await getEmployee(input.employeeId);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_payroll",
    targetType: "employee",
    targetId: input.employeeId,
    targetLabel: emp ? `${emp.employeeNo} ${emp.name}` : input.employeeId,
    detail: { effectiveFrom: input.effectiveFrom, revisionKind: input.revisionKind },
  });
  revalidatePath("/salaries");
  revalidatePath(`/salaries/${input.employeeId}`);
  return { message: "給与改定を登録しました。" };
}

/** 改定の取り消し（無効化）。行は消さず voided_at を立てる。 */
export async function voidSalaryAction(
  _prev: SalaryActionState,
  form: FormData,
): Promise<SalaryActionState> {
  const s = await assertPayrollSession();
  const id = str(form, "id");
  const employeeId = str(form, "employeeId");
  if (!id) return { error: "対象が指定されていません。" };

  await voidSalary(id);
  const emp = employeeId ? await getEmployee(employeeId) : null;
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_payroll",
    targetType: "employee",
    targetId: employeeId || null,
    targetLabel: emp ? `${emp.employeeNo} ${emp.name}` : employeeId,
    detail: { event: "void", salaryId: id },
  });
  revalidatePath("/salaries");
  if (employeeId) revalidatePath(`/salaries/${employeeId}`);
  return { message: "この改定を取り消しました。" };
}


export interface BonusImportActionState {
  error?: string;
  message?: string;
  missing?: string[];
  errors?: { row: number; employeeNo: string; message: string }[];
}

/**
 * 賞与マスタ（給与・考課のExcel）の取込。
 * 給与は can_payroll が前提（このアクション自体のゲート）。
 * 考課は can_evaluation を持っている場合だけ取り込み、無ければ給与のみで続ける。
 */
export async function importBonusMasterAction(
  _prev: BonusImportActionState,
  form: FormData,
): Promise<BonusImportActionState> {
  const s = await assertPayrollSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Excelファイルを選んでください。" };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { error: "ファイルが大きすぎます（15MBまで）。" };
  }

  let sheets;
  try {
    sheets = readXlsx(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { error: `ファイルを読み取れませんでした: ${(e as Error).message}` };
  }
  const wantSheet = (form.get("sheet") ?? "").toString().trim();
  const sheet =
    (wantSheet && sheets.find((x) => x.name === wantSheet)) ||
    sheets.find((x) => looksLikeBonusMaster(x)) ||
    sheets[0];
  if (findHeaderRow(sheet) < 0) {
    return { error: `シート「${sheet.name}」に見出し行（社員番号）が見つかりません。` };
  }

  const effectiveFrom =
    (form.get("effectiveFrom") ?? "").toString().trim() ||
    effectiveFromOfSheetName(sheet.name);
  if (!effectiveFrom) {
    return { error: "適用開始年月が分かりません。シート名に年月が無い場合は指定してください。" };
  }

  const includeEvaluations = s.grant.canEvaluation;
  const result = await importBonusMaster(sheet, {
    effectiveFrom,
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    includeEvaluations,
  });

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_payroll",
    targetType: "salary",
    targetLabel: `賞与マスタ取込（${sheet.name}）`,
    detail: {
      effectiveFrom,
      salariesCreated: result.salariesCreated,
      salariesUpdated: result.salariesUpdated,
      evaluationsCreated: result.evaluationsCreated,
      missing: result.missing.length,
      errorCount: result.errors.length,
    },
  });
  if (includeEvaluations && result.evaluationsCreated > 0) {
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "update_evaluation",
      targetType: "evaluation",
      targetLabel: `賞与マスタ取込（${sheet.name}）`,
      detail: { created: result.evaluationsCreated, skipped: result.evaluationsSkipped },
    });
  }
  revalidatePath("/salaries");
  revalidatePath("/evaluations");

  const parts = [
    `給与 新規 ${result.salariesCreated} 件 / 更新 ${result.salariesUpdated} 件`,
  ];
  if (includeEvaluations) {
    parts.push(`考課 新規 ${result.evaluationsCreated} 件（既存 ${result.evaluationsSkipped} 件は保持）`);
  } else {
    parts.push("考課は権限が無いため取り込みませんでした");
  }
  if (result.missing.length) parts.push(`台帳に居ない ${result.missing.length} 名は対象外`);
  if (result.errors.length) parts.push(`エラー ${result.errors.length} 件`);
  return {
    message: `取り込みました（適用 ${effectiveFrom} / ${parts.join(" / ")}）`,
    missing: result.missing,
    errors: result.errors,
  };
}

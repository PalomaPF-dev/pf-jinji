"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertJinjiSession, assertOwnerSession } from "@/lib/session";
import { getScope, inScope } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { parseCsvObjects } from "@/lib/csv";
import { readXlsx, sheetToObjects } from "@/lib/xlsx";
import {
  importEmployeeDates,
  importRoster,
  looksLikeDatesSheet,
  looksLikeRoster,
} from "@/lib/rosterImport";
import { importHrMaster, looksLikeHrMaster } from "@/lib/hrMasterImport";
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
import {
  addConcurrentPost,
  deleteConcurrentPost,
  validateConcurrentPost,
  type ConcurrentPostInput,
} from "@/lib/concurrentPosts";
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
 * 社員カードの削除。
 *
 * 給与・考課・異動申請・資格・兼務も一緒に消える。**退職の記録を残したいだけなら
 * 在籍状態を「退職」にするのが正**なので、画面でもそちらを先に案内している。
 *
 * 取り消せないので二重に守る:
 *  - ポータル管理者だけが実行できる
 *  - 社員番号を打ち直してもらう（一覧から誤って押しても消えないように）
 */
export async function deleteEmployeeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await assertOwnerSession();
  const id = str(form, "id");
  const target = await getEmployee(id);
  if (!target) return { error: "対象が見つかりません。" };
  if (str(form, "confirm") !== target.employeeNo) {
    // 打った値を返す。React 19 はアクションの後にフォームを初期化するので、
    // 返さないと打ち直しになる（他のフォームと同じ扱い）。
    return {
      error: `確認のため、社員番号「${target.employeeNo}」を入力してください。`,
      values: formValues(form),
    };
  }

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
/**
 * 社員台帳の取込。Excel(.xlsx) と CSV の両方を受ける。
 *
 * Excel をそのまま読めるようにしているのは、CSVに変換させると
 * **社員番号の先頭ゼロが落ちる**（"001081" → 1081）ため。社員番号はポータルの
 * login_id と突き合わせる鍵なので、桁が変わると連携が壊れる。
 *
 * 中身を見て、人事システムの名簿なら名簿用の取込へ、
 * 従来の列（社員番号/氏名/所属コード…）ならCSV取込へ振り分ける。
 */
export async function importEmployeesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await assertJinjiSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選んでください（Excel または CSV）。" };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { error: "ファイルが大きすぎます（15MBまで）。" };
  }

  const isXlsx = /\.xlsx$/i.test(file.name);
  const wantSheet = str(form, "sheet");
  // 改行区切りのテキストエリアで受け取る（1つの値で届くので分割する）
  const parentOrgNames = form
    .getAll("parentOrgNames")
    .flatMap((v) => v.toString().split(/\r?\n/))
    .map((v) => v.trim())
    .filter(Boolean);

  let records: Record<string, string>[];
  let headers: string[] = [];
  try {
    if (isXlsx) {
      const sheets = readXlsx(Buffer.from(await file.arrayBuffer()));

      // 人事マスタ（階層＋承認者の2シート）→ 組織図と台帳（所属・管理者）を作り直す
      if (looksLikeHrMaster(sheets)) {
        const result = await importHrMaster(sheets);
        await recordAudit({
          actorLoginId: s.grant.loginId,
          actorName: s.grant.name,
          action: "update_employee",
          targetType: "employee",
          targetLabel: "人事マスタ（階層・承認者）の取込",
          detail: {
            org: result.org,
            employees: result.employees,
          },
        });
        revalidatePath("/employees");
        revalidatePath("/org");
        const o = result.org;
        const em = result.employees;
        const orgParts = [
          o.rootsCreated ? `本部 ${o.rootsCreated} 件` : "",
          o.groupsCreated ? `部署 ${o.groupsCreated} 件` : "",
          o.unitsCreated ? `組織 ${o.unitsCreated} 件` : "",
          o.moved ? `付け替え ${o.moved} 件` : "",
          o.renamed ? `改称 ${o.renamed} 件` : "",
        ].filter(Boolean);
        return {
          message:
            `人事マスタを取り込みました（社員: 更新 ${em.updated} 名 / 新規 ${em.created} 名 / ` +
            `管理者設定 ${em.managersSet} 名 / 管理者未確定(N/A) ${em.managersUnknown} 名` +
            `${orgParts.length ? ` ・組織: ${orgParts.join(" / ")}` : " ・組織: 変更なし"}）`,
        };
      }

      const sheet = (wantSheet && sheets.find((x) => x.name === wantSheet)) || sheets[0];
      // 見出しが1行目とは限らない（権限マスタは1行目が空で2行目が見出し）。
      // 先頭10行から「社員番号」を含む行を探し、それより上は捨てる。
      const headerAt = sheet.rows
        .slice(0, 10)
        .findIndex((r) => r.some((c) => (c ?? "").replace(/[\s　]+/g, "") === "社員番号"));
      const rows = headerAt > 0 ? sheet.rows.slice(headerAt) : sheet.rows;
      headers = (rows[0] ?? []).map((h) => h.replace(/[\s　]+/g, ""));
      records = sheetToObjects({ name: sheet.name, rows });
    } else {
      const text = await file.text();
      records = parseCsvObjects(text);
      headers = Object.keys(records[0] ?? {});
    }
  } catch (e) {
    return { error: `ファイルを読み取れませんでした: ${(e as Error).message}` };
  }
  if (records.length === 0) return { error: "データ行がありません。" };

  // 人事システムの名簿かどうかで取込経路を分ける
  if (looksLikeRoster(headers)) {
    const result = await importRoster(records, { parentOrgNames });
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "update_employee",
      targetType: "employee",
      targetLabel: "社員名簿の取込",
      detail: {
        created: result.created,
        updated: result.updated,
        orgsCreated: result.orgsCreated,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
    });
    revalidatePath("/employees");
    revalidatePath("/org");
    const parts = [`新規 ${result.created} 件`, `更新 ${result.updated} 件`];
    if (result.orgsCreated) parts.push(`組織を ${result.orgsCreated} 件作成`);
    if (result.skipped) parts.push(`対象外 ${result.skipped} 件`);
    if (result.errors.length) parts.push(`エラー ${result.errors.length} 件`);
    return {
      message: `名簿を取り込みました（${parts.join(" / ")}）`,
      importResult: { created: result.created, updated: result.updated, errors: result.errors },
    };
  }

  // 社員番号＋生年月日・入社年月日のファイル（権限マスタ等）→ 日付だけ補完する
  if (looksLikeDatesSheet(headers)) {
    const result = await importEmployeeDates(records);
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "update_employee",
      targetType: "employee",
      targetLabel: "生年月日・入社日の取込",
      detail: {
        total: result.total,
        updated: result.updated,
        unchanged: result.unchanged,
        missingCount: result.missing.length,
        errorCount: result.errors.length,
      },
    });
    revalidatePath("/employees");
    const parts = [`更新 ${result.updated} 名`, `変更なし ${result.unchanged} 名`];
    if (result.missing.length) parts.push(`台帳に居ない ${result.missing.length} 名`);
    if (result.errors.length) parts.push(`エラー ${result.errors.length} 件`);
    return {
      message: `生年月日・入社日を取り込みました（${parts.join(" / ")}）`,
      importResult: { created: 0, updated: result.updated, errors: result.errors },
    };
  }

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

// ===== 兼務 =====

/**
 * 兼務を足す。
 *
 * 本務は名簿の取込で上書きされるので、兼務は人事側の入力として別に持つ。
 * 範囲外（自分の工場の外）の社員は触れない。
 */
export async function addConcurrentPostAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const s = await assertJinjiSession();
  const employeeId = str(form, "employeeId");
  const target = await getEmployee(employeeId);
  if (!target) return { error: "対象の社員が見つかりません。" };
  const scope = await getScope(s.grant);
  if (!inScope(scope, target.orgUnitId)) return { error: "この社員を編集する権限がありません。" };

  const input: ConcurrentPostInput = {
    employeeId,
    orgUnitId: str(form, "orgUnitId"),
    positionName: nullable(form, "positionName"),
    dutyName: nullable(form, "dutyName"),
    startedOn: nullable(form, "startedOn"),
    endedOn: nullable(form, "endedOn"),
    note: nullable(form, "note"),
  };
  const problem = validateConcurrentPost(input, target.orgUnitId);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await addConcurrentPost(input);
  } catch (e) {
    const msg =
      (e as { code?: string }).code === "23505"
        ? "その組織はすでに兼務先として登録されています。"
        : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_employee",
    targetType: "employee",
    targetId: employeeId,
    targetLabel: `${target.employeeNo} ${target.name}`,
    detail: { 兼務を追加: input.orgUnitId },
  });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/org");
  return { message: "兼務を追加しました。" };
}

/** 兼務を消す。 */
export async function deleteConcurrentPostAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const s = await assertJinjiSession();
  const employeeId = str(form, "employeeId");
  const id = str(form, "id");
  const target = await getEmployee(employeeId);
  if (!target) return { error: "対象の社員が見つかりません。" };
  const scope = await getScope(s.grant);
  if (!inScope(scope, target.orgUnitId)) return { error: "この社員を編集する権限がありません。" };

  await deleteConcurrentPost(id, employeeId);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_employee",
    targetType: "employee",
    targetId: employeeId,
    targetLabel: `${target.employeeNo} ${target.name}`,
    detail: { 兼務を削除: id },
  });
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/org");
  return { message: "兼務を削除しました。" };
}

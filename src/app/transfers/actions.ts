"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertJinjiSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  applyTransfer,
  createBulkTransfer,
  createTransfer,
  decideApproval,
  assignDeptHead,
  deleteTransfer,
  setApprovalAssignee,
  getTransfer,
  listTransferItems,
  submitTransfer,
  updateTransfer,
  validateBulkTransfer,
  validateTransfer,
  type BulkTransferItemInput,
  type TransferInput,
} from "@/lib/transfers";
import { getScope, inScope } from "@/lib/scope";
import { readXlsx } from "@/lib/xlsx";
import {
  looksLikeAppendix,
  parseAppendixSheet,
  type AppendixImportResult,
} from "@/lib/transferAppendix";
import {
  ASSIGNMENT_KINDS,
  COMPANY_CAR_AFTER_KINDS,
  DEPT_AGREEMENTS,
  HOUSING_KINDS,
  MOBILE_AFTER_KINDS,
  PARKING_KINDS,
  SINGLE_ASSIGNMENT_REASONS,
  TRANSFER_APPROVAL_SLOTS,
  YES_NO,
  normalizeTransferFormKind,
  normalizeTransferKind,
  type TransferApprovalSlot,
} from "@/lib/types";
import { formValues, withMulti, type FormValues } from "@/lib/formState";
import { buildPortalPayloadFor, describePushResult, pushToPortal } from "@/lib/portalPush";

export interface TransferActionState {
  error?: string;
  message?: string;
  /** 入力エラーで差し戻すときの送信値。React 19 のフォーム自動リセット対策 */
  values?: FormValues;
  /** 一括申請のExcel取込の結果（フォームが行に流し込む） */
  appendix?: AppendixImportResult;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

function nullable(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v === "" ? null : v;
}

/**
 * 選択肢に載っている値だけを通す。帳票のチェック欄は「未選択」を許すので、
 * 空文字と想定外の値はどちらも null に倒す（不正値がそのまま帳票に出ない）。
 */
function choice(form: FormData, key: string, allowed: readonly string[]): string | null {
  const v = str(form, key);
  return allowed.includes(v) ? v : null;
}

function checked(form: FormData, key: string): boolean {
  return form.get(key) != null;
}

/**
 * 入力エラーで差し戻すときに画面へ返す送信値。
 * 単身赴任事由だけは同名の複数チェックなので、畳んでから返す。
 */
function keepValues(form: FormData): FormValues {
  return withMulti(formValues(form), form, ["singleReasons"]);
}

/** <単身赴任 事由> は複数チェック可。①〜④の添字だけを拾う。 */
function singleReasonIndexes(form: FormData): number[] {
  return form
    .getAll("singleReasons")
    .map((v) => Number(v.toString()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < SINGLE_ASSIGNMENT_REASONS.length)
    .sort((a, b) => a - b);
}

function readInput(form: FormData): TransferInput {
  const relocation = choice(form, "relocation", YES_NO);
  const mobile = choice(form, "mobile", YES_NO);
  const companyCar = choice(form, "companyCar", YES_NO);
  const assignmentAfter = choice(form, "assignmentAfter", ASSIGNMENT_KINDS);
  const companyCarAfter = choice(form, "companyCarAfter", COMPANY_CAR_AFTER_KINDS);

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

    // ===== 指定帳票 J-426(9) の記入欄 =====
    formKind: normalizeTransferFormKind(str(form, "formKind")),
    formDate: nullable(form, "formDate"),
    arrivalDate: nullable(form, "arrivalDate"),
    limitedFrom: nullable(form, "limitedFrom"),
    limitedTo: nullable(form, "limitedTo"),
    deptAgreement: choice(form, "deptAgreement", DEPT_AGREEMENTS),
    orgNameBefore: nullable(form, "orgNameBefore"),
    orgNameAfter: nullable(form, "orgNameAfter"),
    relocation,
    // 転居「なし」なら住居欄は意味を持たないので落とす（帳票に矛盾した印が出ないように）
    housingBefore: relocation === "あり" ? choice(form, "housingBefore", HOUSING_KINDS) : null,
    housingAfter: relocation === "あり" ? choice(form, "housingAfter", HOUSING_KINDS) : null,
    assignmentBefore: choice(form, "assignmentBefore", ASSIGNMENT_KINDS),
    assignmentAfter,
    // 単身赴任事由は異動後が単身赴任のときだけ
    singleReasons: assignmentAfter === "単身赴任" ? singleReasonIndexes(form) : [],
    mobile,
    mobileAfter: mobile === "あり" ? choice(form, "mobileAfter", MOBILE_AFTER_KINDS) : null,
    companyCar,
    companyCarAfter: companyCar === "あり" ? companyCarAfter : null,
    companyCarOther:
      companyCar === "あり" && companyCarAfter === "その他" ? nullable(form, "companyCarOther") : null,
    parking: companyCar === "あり" ? choice(form, "parking", PARKING_KINDS) : null,
    commuteChange: choice(form, "commuteChange", YES_NO),
    explainedAgreed: checked(form, "explainedAgreed"),
    successorChecked: checked(form, "successorChecked"),
    systemDeptCode: nullable(form, "systemDeptCode"),
    systemDeptName: nullable(form, "systemDeptName"),
  };
}

export async function createTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const input = readInput(form);
  const problem = validateTransfer(input);
  if (problem) return { error: problem, values: keepValues(form) };

  let id: string;
  try {
    id = await createTransfer(input, s.grant.loginId, s.grant.name);
  } catch (e) {
    return { error: (e as Error).message, values: keepValues(form) };
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

/**
 * 一括異動申請の対象者をExcelから読み込む。
 *
 * 作成はせず、**読み取った行を返すだけ**にしてある。取り込んだ内容を画面で
 * 確かめてから申請できるようにするため（間違った一覧のまま申請書が起きると、
 * 差し戻しても番号だけが残る）。
 */
export async function importAppendixAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const file = form.get("appendixFile");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選んでください（Excel）。" };
  }
  if (file.size > 10 * 1024 * 1024) return { error: "ファイルが大きすぎます（10MBまで）。" };

  const defaultEffectiveDate = str(form, "effectiveDate") || new Date().toISOString().slice(0, 10);
  const wantSheet = str(form, "appendixSheet");

  try {
    const sheets = readXlsx(Buffer.from(await file.arrayBuffer()));
    const sheet =
      (wantSheet && sheets.find((x) => x.name === wantSheet)) ||
      sheets.find(looksLikeAppendix) ||
      sheets[0];
    const scope = await getScope(s.grant);
    const result = await parseAppendixSheet(sheet, {
      defaultEffectiveDate,
      scopeOrgIds: scope.orgUnitIds,
    });
    if (result.rows.length === 0) return { error: "対象者の行が見つかりませんでした。" };
    const parts = [`${result.ready} 名を読み込みました`];
    if (result.problems) parts.push(`取り込めない行 ${result.problems} 件`);
    return { message: parts.join(" / "), appendix: result };
  } catch (e) {
    return { error: `ファイルを読み取れませんでした: ${(e as Error).message}` };
  }
}

/** 一括異動申請（別紙）の作成。行の実体はJSONで届く。 */
export async function createBulkTransferAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();

  let items: BulkTransferItemInput[];
  try {
    const raw = JSON.parse(str(form, "items") || "[]") as {
      employeeId?: unknown;
      toOrgUnitId?: unknown;
      effectiveDate?: unknown;
      reason?: unknown;
    }[];
    if (!Array.isArray(raw)) throw new Error();
    items = raw.map((x) => ({
      employeeId: String(x.employeeId ?? ""),
      toOrgUnitId: String(x.toOrgUnitId ?? ""),
      effectiveDate: String(x.effectiveDate ?? ""),
      reason: String(x.reason ?? "").trim() || null,
    }));
  } catch {
    return { error: "対象者一覧を読み取れませんでした。もう一度お試しください。" };
  }

  const input = {
    formDate: nullable(form, "formDate"),
    effectiveDate: str(form, "effectiveDate"),
    reason: nullable(form, "reason"),
    remarks: nullable(form, "remarks"),
    items,
  };
  const problem = validateBulkTransfer(input);
  if (problem) return { error: problem };

  // 管理者は自分の工場の外の人を申請に載せられない（画面で絞っていても直送信を弾く）
  const scope = await getScope(s.grant);
  if (scope.orgUnitIds !== null) {
    const sqlMod = await import("@/lib/neon");
    const rows = await sqlMod.getSql()`
      SELECT id, org_unit_id FROM jinji_employees
      WHERE id = ANY(${items.map((x) => x.employeeId)}::uuid[])`;
    for (const r of rows as { id: string; org_unit_id: string | null }[]) {
      if (!inScope(scope, r.org_unit_id)) {
        return { error: "表示範囲（自分の工場）の外の社員が含まれています。" };
      }
    }
  }

  let id: string;
  try {
    id = await createBulkTransfer(input, s.grant.loginId, s.grant.name);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const t = await getTransfer(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "create_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: t ? `${t.transferNo} 一括申請（${items.length}名）` : id,
    detail: { bulk: true, count: items.length },
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
  if (!id) return { error: "対象が指定されていません。", values: keepValues(form) };
  const input = readInput(form);
  const problem = validateTransfer(input);
  if (problem) return { error: problem, values: keepValues(form) };

  try {
    await updateTransfer(id, input);
  } catch (e) {
    return { error: (e as Error).message, values: keepValues(form) };
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
    next = await decideApproval(
      id,
      slot,
      decision,
      s.grant.loginId,
      s.grant.name,
      nullable(form, "comment"),
      s.grant.isOwner,
    );
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

  // 発令したらポータルの所属も追従させる。ここが繋がることで、異動が各業務アプリの
  // 部署・権限にまで反映される。
  // 連携に失敗しても発令そのものは成立しているので、状態は戻さず注意書きだけ添える
  // （設定画面の「ポータルへ連携」から後追いでやり直せる）。
  let portalNote = "";
  // 一括申請は別紙の全員をポータルへ連携する
  const pushNos = before?.isBulk
    ? (await listTransferItems(id)).map((i) => i.employeeNo).filter(Boolean)
    : before?.employeeNo
      ? [before.employeeNo]
      : [];
  if (pushNos.length > 0) {
    try {
      const result = await pushToPortal(await buildPortalPayloadFor(pushNos));
      if (result.errors.length > 0) {
        portalNote = `ただしポータルへの連携は失敗しました（${result.errors[0].message}）。設定画面から連携し直してください。`;
      } else {
        portalNote = `ポータルへも連携しました（${describePushResult(result)}）。`;
      }
      await recordAudit({
        actorLoginId: s.grant.loginId,
        actorName: s.grant.name,
        action: "push_portal",
        targetType: "employee",
        targetId: before?.employeeId,
        targetLabel: before?.isBulk
          ? `一括発令 ${pushNos.length}名`
          : `${before?.employeeNo} ${before?.employeeName}`,
        detail: { trigger: "apply_transfer", errorCount: result.errors.length },
      });
    } catch (e) {
      portalNote = `ただしポータルへの連携は失敗しました（${(e as Error).message}）。設定画面から連携し直してください。`;
    }
  }

  return { message: `発令し、人事マスターへ反映しました。${portalNote}` };
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

/**
 * 承認欄の担当者を決める。
 *
 * 部門長は申請部署から自動で入るが、兼任や代理で違う人になることがあるので
 * ここで直せるようにしてある。役員は部署から機械的に決まらないので社員番号で指定する。
 */
export async function setApproverAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const slot = str(form, "slot");
  if (!TRANSFER_APPROVAL_SLOTS.some((x) => x.slot === slot)) {
    return { error: "承認欄の指定が不正です。" };
  }
  const t = await getTransfer(id);
  if (!t) return { error: "対象が見つかりません。" };
  if (t.status === "issued") return { error: "発令済みの申請書は変更できません。" };

  let set: { name: string } | null;
  try {
    set = await setApprovalAssignee(id, slot, str(form, "employeeNo"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: `${t.transferNo} ${t.employeeName}`,
    detail: { slot, assignee: set?.name ?? null },
  });
  revalidatePath(`/transfers/${id}`);
  return { message: set ? `${set.name} さんを担当に設定しました。` : "担当を外しました。" };
}

/** 部門長を申請部署から当て直す（所属を直したあとなどに使う）。 */
export async function refreshDeptHeadAction(
  _prev: TransferActionState,
  form: FormData,
): Promise<TransferActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const t = await getTransfer(id);
  if (!t) return { error: "対象が見つかりません。" };
  if (t.status === "issued") return { error: "発令済みの申請書は変更できません。" };
  await assignDeptHead(id, t.fromOrgUnitId);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: `${t.transferNo} ${t.employeeName}`,
    detail: { event: "refreshDeptHead" },
  });
  revalidatePath(`/transfers/${id}`);
  return { message: "部門長を申請部署から当て直しました。" };
}

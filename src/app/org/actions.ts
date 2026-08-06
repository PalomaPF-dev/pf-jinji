"use server";

import { revalidatePath } from "next/cache";
import { assertJinjiSession, assertOwnerSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  createOrgUnit,
  deleteOrgUnit,
  getOrgUnit,
  syncPortalOrgUnits,
  updateOrgUnit,
  type OrgUnitInput,
} from "@/lib/org";
import { randomUUID } from "crypto";
import { normalizeOrgKind } from "@/lib/types";
import { formValues, type FormValues } from "@/lib/formState";

export interface OrgActionState {
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

function readOrgInput(form: FormData): OrgUnitInput {
  return {
    code: str(form, "code"),
    name: str(form, "name"),
    kind: normalizeOrgKind(str(form, "kind")),
    parentId: nullable(form, "parentId"),
    sort: Number(str(form, "sort")) || 0,
    headEmployeeId: nullable(form, "headEmployeeId"),
    description: nullable(form, "description"),
    validFrom: nullable(form, "validFrom"),
    validTo: nullable(form, "validTo"),
    deptCode: nullable(form, "deptCode"),
    workplaceCode: nullable(form, "workplaceCode"),
  };
}

/** 部署コード・職場コードの書式。人事システムの8桁コードを想定しつつ緩めにしてある。 */
const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

function validateCodes(input: OrgUnitInput): string | null {
  if (input.deptCode && !CODE_RE.test(input.deptCode)) {
    return "部署コードは半角英数字とハイフン・アンダースコア（20文字以内）で入力してください。";
  }
  if (input.workplaceCode && !CODE_RE.test(input.workplaceCode)) {
    return "職場コードは半角英数字とハイフン・アンダースコア（20文字以内）で入力してください。";
  }
  return null;
}

function validate(input: OrgUnitInput): string | null {
  const codes = validateCodes(input);
  if (codes) return codes;
  if (!input.code) return "組織コードは必須です。";
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(input.code)) {
    return "組織コードは半角英数字とハイフン・アンダースコア（20文字以内）で入力してください。";
  }
  if (!input.name) return "組織名は必須です。";
  if (input.validFrom && input.validTo && input.validFrom > input.validTo) {
    return "有効期間の終了日が開始日より前になっています。";
  }
  return null;
}

/** 組織単位の新規作成。 */
export async function createOrgUnitAction(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const s = await assertJinjiSession();
  const input = readOrgInput(form);
  // 組織コードはアプリ内の識別子でしかない。配置表から作るときに番号を考えさせたくないので、
  // 空なら 職場コード → 部署コード → 自動採番 の順で埋める。
  if (!input.code) {
    input.code =
      input.workplaceCode ||
      input.deptCode ||
      `ORG-${randomUUID().slice(0, 8).toUpperCase()}`;
  }
  const problem = validate(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    const id = await createOrgUnit(input);
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "update_org",
      targetType: "org_unit",
      targetId: id,
      targetLabel: `${input.code} ${input.name}`,
      detail: { event: "create" },
    });
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? `組織コード ${input.code} は既に使われています。`
      : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  revalidatePath("/org");
  return { message: `「${input.name}」を追加しました。` };
}

/** 組織単位の更新（階層・並び順・上長を含む）。 */
export async function updateOrgUnitAction(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。", values: formValues(form) };
  const input = readOrgInput(form);
  const problem = validate(input);
  if (problem) return { error: problem, values: formValues(form) };

  const before = await getOrgUnit(id);
  if (!before) return { error: "対象が見つかりません。" };

  try {
    await updateOrgUnit(id, input);
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? `組織コード ${input.code} は既に使われています。`
      : (e as Error).message;
    return { error: msg, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_org",
    targetType: "org_unit",
    targetId: id,
    targetLabel: `${input.code} ${input.name}`,
    detail: { parentBefore: before.parentId, parentAfter: input.parentId },
  });
  revalidatePath("/org");
  return { message: `「${input.name}」を更新しました。` };
}

/**
 * 組織単位の削除。所属者が居るときは lib 側で弾かれる。
 * moveChildren を送ると、配下の組織を1つ上へ引き上げてから削除する。
 */
export async function deleteOrgUnitAction(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const moveChildren = str(form, "moveChildren") === "1";
  const target = await getOrgUnit(id);
  if (!target) return { error: "対象が見つかりません。" };

  try {
    await deleteOrgUnit(id, { moveChildrenToParent: moveChildren });
  } catch (e) {
    return { error: (e as Error).message };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_org",
    targetType: "org_unit",
    targetId: id,
    targetLabel: `${target.code} ${target.name}`,
    detail: { event: "delete", movedChildren: moveChildren },
  });
  revalidatePath("/org");
  return { message: `「${target.name}」を削除しました。` };
}

/**
 * ポータル部署マスターの同期。
 * 組織の増減はアプリ全体に影響するため、責任者（owner）のみ実行できる。
 */
/**
 * 名称の規則から中間層（工場・部）を組む。
 * 名簿取込のたびにも自動で走るが、規則を変えた後などに手で叩き直せるようにしておく。
 */
export async function restructureOrgAction(_prev: OrgActionState): Promise<OrgActionState> {
  const s = await assertOwnerSession();
  try {
    const { restructureOrgByName } = await import("@/lib/orgRestructure");
    const r = await restructureOrgByName();
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "update_org",
      targetType: "org_unit",
      targetLabel: "名称から階層を自動整理",
      detail: { ...r },
    });
    revalidatePath("/org");
    return {
      message: `整理しました（中間層を ${r.middlesCreated} 件作成 / ${r.moved} 件を配下へ移動）`,
    };
  } catch (e) {
    return { error: `整理に失敗しました: ${(e as Error).message}` };
  }
}

export async function syncPortalAction(_prev: OrgActionState): Promise<OrgActionState> {
  const s = await assertOwnerSession();
  try {
    const result = await syncPortalOrgUnits();
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "sync_portal",
      targetType: "org_unit",
      targetLabel: "ポータル部署マスター同期",
      detail: { ...result },
    });
    revalidatePath("/org");
    const orphanNote = result.orphans.length
      ? `／ポータル側で見つからない組織 ${result.orphans.length} 件（${result.orphans.join("、")}）`
      : "";
    return {
      message: `同期しました（新規 ${result.created} 件 / 名称更新 ${result.updated} 件${orphanNote}）`,
    };
  } catch (e) {
    return { error: `同期に失敗しました: ${(e as Error).message}` };
  }
}


/**
 * 組織名・部署コード・職場コードを直す（設定画面の行ごとの保存）。
 *
 * 階層と組織の長は触らない。名称とコードは人事システムの台帳・ポータル連携の
 * 突合に使う値なので、ここだけを安全に直せるようにしてある。
 */
export async function updateOrgCodesAction(
  _prev: OrgActionState,
  form: FormData,
): Promise<OrgActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const before = await getOrgUnit(id);
  if (!before) return { error: "対象が見つかりません。" };

  const name = str(form, "name");
  if (!name) return { error: "組織名は必須です。", values: formValues(form) };
  // 上位組織は送られてきたときだけ変える（コードの設定画面は階層を触らない）
  const parentId = form.has("parentId") ? nullable(form, "parentId") : before.parentId;
  const kind = form.has("kind") ? normalizeOrgKind(str(form, "kind")) : before.kind;
  const headEmployeeId = form.has("headEmployeeId")
    ? nullable(form, "headEmployeeId")
    : before.headEmployeeId;

  const input: OrgUnitInput = {
    code: before.code,
    name,
    kind,
    parentId,
    sort: before.sort,
    headEmployeeId,
    description: before.description,
    validFrom: before.validFrom,
    validTo: before.validTo,
    deptCode: nullable(form, "deptCode"),
    workplaceCode: nullable(form, "workplaceCode"),
  };
  const problem = validateCodes(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await updateOrgUnit(id, input);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_org",
    targetType: "org_unit",
    targetId: id,
    targetLabel: `${before.code} ${name}`,
    detail: {
      event: "codes",
      nameBefore: before.name,
      nameAfter: name,
      parentBefore: before.parentId,
      parentAfter: parentId,
      deptCodeBefore: before.deptCode,
      deptCodeAfter: input.deptCode,
      workplaceCodeBefore: before.workplaceCode,
      workplaceCodeAfter: input.workplaceCode,
    },
  });
  revalidatePath("/org");
  const moved = parentId !== before.parentId;
  return {
    message: moved
      ? `「${name}」の上位組織を変えました。`
      : before.name === name
        ? `「${name}」のコードを保存しました。`
        : `「${before.name}」を「${name}」に変更しました。`,
  };
}

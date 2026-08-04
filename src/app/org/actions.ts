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
import { normalizeOrgKind } from "@/lib/types";

export interface OrgActionState {
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
  };
}

function validate(input: OrgUnitInput): string | null {
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
  const problem = validate(input);
  if (problem) return { error: problem };

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
    return { error: msg };
  }

  revalidatePath("/org");
  revalidatePath("/org/edit");
  return { message: `「${input.name}」を追加しました。` };
}

/** 組織単位の更新（階層・並び順・上長を含む）。 */
export async function updateOrgUnitAction(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  if (!id) return { error: "対象が指定されていません。" };
  const input = readOrgInput(form);
  const problem = validate(input);
  if (problem) return { error: problem };

  const before = await getOrgUnit(id);
  if (!before) return { error: "対象が見つかりません。" };

  try {
    await updateOrgUnit(id, input);
  } catch (e) {
    const msg = (e as { code?: string }).code === "23505"
      ? `組織コード ${input.code} は既に使われています。`
      : (e as Error).message;
    return { error: msg };
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
  revalidatePath("/org/edit");
  return { message: `「${input.name}」を更新しました。` };
}

/** 組織単位の削除。所属者が居るときは lib 側で弾かれる。 */
export async function deleteOrgUnitAction(_prev: OrgActionState, form: FormData): Promise<OrgActionState> {
  const s = await assertJinjiSession();
  const id = str(form, "id");
  const target = await getOrgUnit(id);
  if (!target) return { error: "対象が見つかりません。" };

  try {
    await deleteOrgUnit(id);
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
    detail: { event: "delete" },
  });
  revalidatePath("/org");
  revalidatePath("/org/edit");
  return { message: `「${target.name}」を削除しました。` };
}

/**
 * ポータル部署マスターの同期。
 * 組織の増減はアプリ全体に影響するため、責任者（owner）のみ実行できる。
 */
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
    revalidatePath("/org/edit");
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

"use server";

import { revalidatePath } from "next/cache";
import { assertOwnerSession } from "@/lib/session";
import { clearAuditLogs, recordAudit } from "@/lib/audit";
import { formValues, type FormValues } from "@/lib/formState";
import {
  assertNotLastOwner,
  issuePasswordLink,
  removeAdmin,
  upsertAdmin,
  validateAdmin,
  type AdminInput,
} from "@/lib/admins";

export interface SettingsActionState {
  error?: string;
  message?: string;
  values?: FormValues;
  /** 発行したパスワード設定リンク（画面に1度だけ表示する） */
  inviteUrl?: string;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

function bool(form: FormData, key: string): boolean {
  return str(form, key) === "on";
}

/**
 * 利用許可名簿の追加・更新。
 * この操作だけが「このアプリを誰が使えるか」を決めるため、責任者（owner）限定にしている。
 */
export async function upsertAdminAction(
  _prev: SettingsActionState,
  form: FormData,
): Promise<SettingsActionState> {
  const s = await assertOwnerSession();
  const input: AdminInput = {
    loginId: str(form, "loginId"),
    name: str(form, "name"),
    isOwner: bool(form, "isOwner"),
    canPayroll: bool(form, "canPayroll"),
    canEvaluation: bool(form, "canEvaluation"),
    note: str(form, "note") || null,
  };
  const problem = validateAdmin(input);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await assertNotLastOwner(input.loginId, input.isOwner);
    await upsertAdmin(input, s.grant.loginId);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_admin",
    targetType: "jinji_admins",
    targetId: input.loginId,
    targetLabel: `${input.loginId} ${input.name}`,
    detail: {
      isOwner: input.isOwner,
      canPayroll: input.canPayroll,
      canEvaluation: input.canEvaluation,
    },
  });
  revalidatePath("/settings");
  return { message: `${input.name} さんの利用許可を保存しました。` };
}

/** 名簿から外す。外した瞬間からアプリを使えなくなる。 */
export async function removeAdminAction(
  _prev: SettingsActionState,
  form: FormData,
): Promise<SettingsActionState> {
  const s = await assertOwnerSession();
  const loginId = str(form, "loginId");
  if (!loginId) return { error: "対象が指定されていません。" };
  if (loginId === s.grant.loginId) {
    return { error: "自分自身は名簿から外せません。" };
  }
  try {
    await removeAdmin(loginId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_admin",
    targetType: "jinji_admins",
    targetId: loginId,
    targetLabel: loginId,
    detail: { event: "remove" },
  });
  revalidatePath("/settings");
  return { message: `${loginId} を名簿から外しました。` };
}

/** パスワード設定リンクの発行（メール送信はせず、画面に出して手渡しする）。 */
export async function issueLinkAction(
  _prev: SettingsActionState,
  form: FormData,
): Promise<SettingsActionState> {
  const s = await assertOwnerSession();
  const loginId = str(form, "loginId");
  const name = str(form, "name") || loginId;
  if (!loginId) return { error: "対象が指定されていません。" };

  let url: string;
  try {
    url = await issuePasswordLink(loginId, name);
  } catch (e) {
    return { error: (e as Error).message };
  }

  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_admin",
    targetType: "jinji_admins",
    targetId: loginId,
    targetLabel: loginId,
    detail: { event: "issue_password_link" },
  });
  return { message: `${name} さんの設定リンクを発行しました（有効期限7日）。`, inviteUrl: url };
}


/**
 * 監査ログを全件削除する。
 *
 * 取込を回すと1回で数百件の記録が積み上がり、直近の操作が埋もれてしまうため、
 * 棚卸しできるようにしてある。**消した事実だけは1件残す**（誰がいつ全消ししたかが
 * 分からなくなると、記録として意味を持たなくなるため）。
 */
export async function clearAuditLogsAction(): Promise<SettingsActionState> {
  const s = await assertOwnerSession();
  try {
    const removed = await clearAuditLogs();
    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "update_admin",
      targetType: "audit",
      targetLabel: "監査ログを全件削除",
      detail: { removed },
    });
    revalidatePath("/settings");
    return { message: `監査ログ ${removed} 件を削除しました。` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

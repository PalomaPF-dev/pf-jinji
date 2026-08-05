"use server";

import { assertOwnerSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  buildPortalSync,
  describePushResult,
  pushToPortal,
  type PortalEmployeePayload,
  type PortalOrgPayload,
} from "@/lib/portalPush";

export interface PortalPushState {
  error?: string;
  message?: string;
  /** 送信前の確認用（連携せずに中身だけ見る） */
  preview?: PortalEmployeePayload[];
  /** 送信前の確認用（組織） */
  previewOrgs?: PortalOrgPayload[];
  /** 連携に失敗した社員 */
  failures?: { loginId: string; message: string }[];
}

/**
 * 連携内容の下見。実際には送らず、何がポータルへ行くのかだけ見せる。
 * 人事情報を外へ出す操作なので、中身を確認してから実行できるようにしている。
 */
export async function previewPortalPushAction(): Promise<PortalPushState> {
  await assertOwnerSession();
  try {
    const { orgs, employees } = await buildPortalSync();
    const withManager = employees.filter((e) => e.managerLoginId).length;
    return {
      preview: employees,
      previewOrgs: orgs,
      message:
        `組織 ${orgs.length} 件（部署 ${orgs.filter((o) => o.kind === "dept").length} / ` +
        `職場 ${orgs.filter((o) => o.kind === "workplace").length}）、` +
        `社員 ${employees.length} 名（うち管理者(承認者)あり ${withManager} 名）が連携対象です。` +
        `内容を確認してから「ポータルへ連携」を実行してください。`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * 組織と全社員をポータルへ連携する。
 *
 * 人事管理を正とするので、組織（部署・職場）も一緒に送る。ポータル側は
 * 同名の既存があればそれに紐づけ、無ければ作る（アプリ割当は既存を壊さない）。
 * ポータルに居ない社員のアカウントは、パスワード未設定の招待状態で作る。
 */
export async function pushPortalAction(): Promise<PortalPushState> {
  const s = await assertOwnerSession();
  try {
    const { orgs, employees } = await buildPortalSync();
    const result = await pushToPortal(employees, { orgs, createMissing: true });
    const summary = describePushResult(result);

    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "push_portal",
      targetType: "portal",
      targetLabel: "ポータルへ組織・人事情報を連携（全件）",
      detail: {
        orgs: result.orgs,
        sent: result.sent,
        created: result.created,
        updated: result.updated,
        approverSet: result.approverSet,
        skipped: result.skipped,
        reprovisioned: result.reprovisioned,
        errorCount: result.errors.length,
      },
    });

    if (result.errors.length > 0 && result.created + result.updated === 0) {
      return { error: `連携できませんでした: ${result.errors[0].message}`, failures: result.errors };
    }
    return {
      message: summary,
      failures: result.errors.length > 0 ? result.errors : undefined,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

"use server";

import { assertOwnerSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  buildPortalUsers,
  describePushResult,
  pushToPortal,
  type PortalEmployeePayload,
} from "@/lib/portalPush";

export interface PortalPushState {
  error?: string;
  message?: string;
  /** 送信前の確認用（連携せずに中身だけ見る） */
  preview?: PortalEmployeePayload[];
  /** 連携に失敗した社員 */
  failures?: { loginId: string; message: string }[];
}

/**
 * 連携内容の下見。実際には送らず、何がポータルへ行くのかだけ見せる。
 * 外へ出す操作なので、中身を確認してから実行できるようにしている。
 */
export async function previewPortalPushAction(): Promise<PortalPushState> {
  await assertOwnerSession();
  try {
    const users = await buildPortalUsers();
    const withManager = users.filter((e) => e.managerLoginId).length;
    return {
      preview: users,
      message:
        `ユーザー ${users.length} 名（うち管理者(承認者)あり ${withManager} 名）が連携対象です。` +
        `内容を確認してから「ポータルへ同期」を実行してください。`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * 全社員をポータルのユーザーとして同期する。
 *
 * 送るのは「氏名・在籍状態・管理者（承認者）」だけ。部署・工場や
 * アプリの割当はポータル側の運用なので触らない。
 * ポータルに居ない社員のアカウントは、パスワード未設定の招待状態で作る。
 */
export async function pushPortalAction(): Promise<PortalPushState> {
  const s = await assertOwnerSession();
  try {
    const users = await buildPortalUsers();
    const result = await pushToPortal(users, { createMissing: true });
    const summary = describePushResult(result);

    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "push_portal",
      targetType: "portal",
      targetLabel: "ポータルへユーザーを同期（全件）",
      detail: {
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

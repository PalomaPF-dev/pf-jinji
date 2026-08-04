"use server";

import { assertOwnerSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  buildPortalPayload,
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
 * 人事情報を外へ出す操作なので、中身を確認してから実行できるようにしている。
 */
export async function previewPortalPushAction(): Promise<PortalPushState> {
  await assertOwnerSession();
  try {
    const payload = await buildPortalPayload();
    return {
      preview: payload,
      message: `連携対象は ${payload.length} 名です。内容を確認してから「ポータルへ連携」を実行してください。`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 全社員をポータルへ連携する。 */
export async function pushPortalAction(): Promise<PortalPushState> {
  const s = await assertOwnerSession();
  try {
    const payload = await buildPortalPayload();
    const result = await pushToPortal(payload);
    const summary = describePushResult(result);

    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "push_portal",
      targetType: "portal",
      targetLabel: "ポータルへ人事情報を連携（全件）",
      detail: {
        sent: result.sent,
        created: result.created,
        updated: result.updated,
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

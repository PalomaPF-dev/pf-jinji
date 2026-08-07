"use server";

import { assertOwnerSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  buildPortalUsers,
  describePushResult,
  prunePortalUsers,
  pushToPortal,
  type PortalEmployeePayload,
  type PortalStrayUser,
} from "@/lib/portalPush";

export interface PortalPushState {
  error?: string;
  message?: string;
  /** 送信前の確認用（連携せずに中身だけ見る） */
  preview?: PortalEmployeePayload[];
  /** 連携に失敗した社員 */
  failures?: { loginId: string; message: string }[];
  /** ポータルにしか居ない人（社員台帳に無いユーザー） */
  strays?: PortalStrayUser[];
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

/**
 * ポータルにしか居ない人の下見。実際には消さない。
 *
 * 社員台帳に無いユーザーは、退職済みで台帳から消した人・アプリ用に手で作った人
 * などが混ざる。名前を見てから消せるように、確認と実行を分けている。
 */
export async function previewPortalPruneAction(): Promise<PortalPushState> {
  await assertOwnerSession();
  try {
    const users = await buildPortalUsers();
    const r = await prunePortalUsers(users);
    if (r.errors.length > 0) return { error: r.errors[0].message };
    if (r.users === 0) {
      return { message: "ポータルにしか居ない人は居ません。名簿は社員台帳と一致しています。" };
    }
    return {
      strays: r.list,
      message:
        `ポータルにしか居ない人が ${r.users} 名います。` +
        `内容を確認してから「ポータルから削除」を実行してください` +
        `（ポータル管理のユーザーは消えません）。`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** 社員台帳に無いユーザーをポータルから削除する（名簿を台帳に揃える）。 */
export async function portalPruneAction(): Promise<PortalPushState> {
  const s = await assertOwnerSession();
  try {
    const users = await buildPortalUsers();
    const r = await prunePortalUsers(users, { confirm: true });
    if (r.errors.length > 0) return { error: r.errors[0].message };

    await recordAudit({
      actorLoginId: s.grant.loginId,
      actorName: s.grant.name,
      action: "push_portal",
      targetType: "portal",
      targetLabel: "ポータルから社員台帳に無いユーザーを削除",
      detail: { deleted: r.deleted, keep: users.length },
    });

    return {
      message:
        r.deleted === 0
          ? "削除する人は居ませんでした。"
          : `ポータルから ${r.deleted} 名を削除しました（各アプリ側のアカウントは残ります）。`,
      strays: r.list,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

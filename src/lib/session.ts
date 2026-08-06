import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./authOptions";
import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { JinjiGrant } from "./types";

/**
 * アクセス制御は二段構え。
 *
 *   ゲート1（ログイン）  … next-auth。社員番号＋パスワード、またはポータルからのSSO。
 *   ゲート2（利用許可）  … **ポータルの権限**で決まる。満たさない社員番号は
 *                          ログインできても /forbidden へ。
 *
 * ポータルの権限と機能の対応:
 *   - ポータル管理者（users.role = 'admin'）
 *       … 全機能。基本給与・人事考課・設定（管理グループ）はこの人だけ。
 *   - ポータルの管理者権限（users.can_manage）
 *       … その他の機能（社員台帳・組織図・異動申請・継続雇用・資格）。
 *
 * ポータルの権限は SSO とプロビジョニングの両方で届き、users テーブルに保存する。
 * 判定は JWT に載せず **毎回 DB から引く**。ポータルで管理者を外した瞬間に、手元に
 * 残っているセッションでも即座に効かせるため（ポータルの requireManageSession と同じ思想）。
 *
 * jinji_admins 名簿は**責任者（is_owner）の逃げ道**としてだけ残す。ポータルの権限が
 * 同期されない状態（ポータル障害・開発環境）でも、名簿の責任者は入室でき全機能を使える。
 * これが無いと、ポータル側の設定ひとつで誰もアプリを管理できない状態に陥る。
 * （名簿の can_payroll / can_evaluation はこの整理で廃止。列は残るが判定には使わない）
 */

export interface JinjiSession {
  userId: string;
  loginId: string;
  userName: string;
  email: string;
  companyId: string;
  companyName: string;
  grant: JinjiGrant;
}

/** ログイン中ユーザーの基本情報。未ログインなら null。 */
async function baseSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.companyId) return null;
  // SSO 経由・旧セッションで loginId が空のときは、users からの解決にフォールバックする
  let loginId = (session.user.loginId ?? "").trim();
  if (!loginId) {
    try {
      const sql = getSql();
      const rows = await sql`SELECT login_id FROM users WHERE id = ${session.user.id} LIMIT 1`;
      loginId = ((rows[0]?.login_id as string | null) ?? "").trim();
    } catch {
      loginId = "";
    }
  }
  return {
    userId: session.user.id,
    loginId,
    userName: session.user.name ?? "",
    email: session.user.email ?? "",
    companyId: session.user.companyId,
    companyName: session.user.companyName,
  };
}

/**
 * 入室可否と権限を1回のDBアクセスで決める。使えないなら null。
 *
 * 入室できるのは次のいずれか。
 *   - ポータル管理者（users.role = 'admin'）… 全機能
 *   - ポータルの管理者権限（users.can_manage）… 給与・考課・設定を除く機能
 *   - 人事の責任者（jinji_admins.is_owner）… ポータルに依存しない逃げ道。全機能
 */
export async function findGrant(loginId: string): Promise<JinjiGrant | null> {
  if (!loginId) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT u.role, u.can_manage,
           a.login_id AS admin_login_id, a.name AS admin_name, a.is_owner
    FROM users u
    LEFT JOIN jinji_admins a ON a.login_id = u.login_id
    WHERE u.login_id = ${loginId}
    LIMIT 1`;
  const r = rows[0];
  if (!r) return null;

  const isPortalAdmin = r.role === "admin";
  const isManager = Boolean(r.can_manage);
  const isOwnerRoster = Boolean(r.is_owner);
  if (!isPortalAdmin && !isManager && !isOwnerRoster) return null;

  // 給与・考課・設定はナビの「ポータル管理者のみ」。
  // ポータル管理者（と名簿の責任者）だけに開き、can_manage の管理者には見せない。
  const full = isPortalAdmin || isOwnerRoster;
  return {
    loginId,
    name: (r.admin_name as string | null) ?? loginId,
    isPortalAdmin,
    isOwner: full,
    canPayroll: full,
    canEvaluation: full,
  };
}

/** 利用許可名簿が1件も無い＝初期セットアップ前。 */
export async function isUnconfigured(): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT count(*)::int AS n FROM jinji_admins`;
  return (rows[0]?.n as number) === 0;
}

/**
 * ページ用の基本ガード。ログイン必須＋利用許可名簿にあること。
 * 未ログインは /login、名簿に無ければ /forbidden へリダイレクトする。
 */
export async function requireJinjiSession(): Promise<JinjiSession> {
  const s = await baseSession();
  if (!s) redirect("/login");
  const grant = await findGrant(s.loginId);
  if (!grant) redirect("/forbidden");
  return { ...s, grant };
}

/** 基本給与を扱えるセッション。権限が無ければ /forbidden?need=payroll。 */
export async function requirePayrollSession(): Promise<JinjiSession> {
  const s = await requireJinjiSession();
  if (!s.grant.canPayroll) redirect("/forbidden?need=payroll");
  return s;
}

/** 人事考課を扱えるセッション。権限が無ければ /forbidden?need=evaluation。 */
export async function requireEvaluationSession(): Promise<JinjiSession> {
  const s = await requireJinjiSession();
  if (!s.grant.canEvaluation) redirect("/forbidden?need=evaluation");
  return s;
}

/** 利用許可名簿・各種マスターを編集できるセッション。 */
export async function requireOwnerSession(): Promise<JinjiSession> {
  const s = await requireJinjiSession();
  if (!s.grant.isOwner) redirect("/forbidden?need=owner");
  return s;
}

/**
 * Server Action 用のガード。リダイレクトではなく例外を投げる
 * （フォーム送信の途中でリダイレクトすると、失敗理由が利用者に伝わらないため）。
 */
export async function assertJinjiSession(): Promise<JinjiSession> {
  const s = await baseSession();
  if (!s) throw new Error("ログインが必要です。");
  const grant = await findGrant(s.loginId);
  if (!grant) throw new Error("このアプリの利用が許可されていません。");
  return { ...s, grant };
}

export async function assertPayrollSession(): Promise<JinjiSession> {
  const s = await assertJinjiSession();
  if (!s.grant.canPayroll) throw new Error("基本給与はポータル管理者のみが操作できます。");
  return s;
}

export async function assertEvaluationSession(): Promise<JinjiSession> {
  const s = await assertJinjiSession();
  if (!s.grant.canEvaluation) throw new Error("人事考課はポータル管理者のみが操作できます。");
  return s;
}

export async function assertOwnerSession(): Promise<JinjiSession> {
  const s = await assertJinjiSession();
  if (!s.grant.isOwner) throw new Error("この操作はポータル管理者のみが行えます。");
  return s;
}

/**
 * リダイレクトせずに現在の権限だけ返す（共通シェルのナビ表示用）。
 * 未ログイン・DB未設定・取得失敗はいずれも null（シェルの描画を壊さない）。
 */
export async function getOptionalGrant(): Promise<JinjiGrant | null> {
  try {
    const s = await baseSession();
    if (!s) return null;
    return await findGrant(s.loginId);
  } catch {
    return null;
  }
}

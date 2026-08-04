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
 *   ゲート2（利用許可）  … jinji_admins 名簿。ここに載っていない社員番号は、
 *                          ログインできてもアプリを使えない（/forbidden へ）。
 *
 * 名簿は JWT に載せず **毎回 DB から引く**。権限を外した瞬間に、手元に残っている
 * セッションでも即座に効かせるため（ポータルの requireManageSession と同じ思想）。
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
 * 利用許可名簿を引く。載っていなければ null。
 * is_owner は名簿の管理者。給与・考課は個別フラグだが、owner は常に見られる。
 */
export async function findGrant(loginId: string): Promise<JinjiGrant | null> {
  if (!loginId) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT login_id, name, is_owner, can_payroll, can_evaluation
    FROM jinji_admins WHERE login_id = ${loginId} LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  const isOwner = Boolean(r.is_owner);
  return {
    loginId: r.login_id as string,
    name: (r.name as string) ?? loginId,
    isOwner,
    canPayroll: isOwner || Boolean(r.can_payroll),
    canEvaluation: isOwner || Boolean(r.can_evaluation),
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
  if (!s.grant.canPayroll) throw new Error("基本給与を操作する権限がありません。");
  return s;
}

export async function assertEvaluationSession(): Promise<JinjiSession> {
  const s = await assertJinjiSession();
  if (!s.grant.canEvaluation) throw new Error("人事考課を操作する権限がありません。");
  return s;
}

export async function assertOwnerSession(): Promise<JinjiSession> {
  const s = await assertJinjiSession();
  if (!s.grant.isOwner) throw new Error("この操作は人事の責任者（owner）のみが行えます。");
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

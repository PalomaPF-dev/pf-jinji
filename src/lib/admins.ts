import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { generateResetToken, hashResetToken, resetLinkBase } from "./passwordReset";
import { createInvitedUser, getOrCreateCompanyByName, BOOTSTRAP_COMPANY_NAME } from "./authDb";
import type { JinjiAdmin } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 利用許可名簿の操作。このアプリを使える社員番号を決める、権限の中枢。
 */

function mapAdmin(r: any): JinjiAdmin {
  return {
    loginId: r.login_id,
    name: r.name,
    isOwner: Boolean(r.is_owner),
    canPayroll: Boolean(r.can_payroll),
    canEvaluation: Boolean(r.can_evaluation),
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}

export async function listAdmins(): Promise<JinjiAdmin[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM jinji_admins ORDER BY is_owner DESC, created_at ASC`;
  return rows.map(mapAdmin);
}

export async function countOwners(): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT count(*)::int AS n FROM jinji_admins WHERE is_owner`;
  return (rows[0]?.n as number) ?? 0;
}

export interface AdminInput {
  loginId: string;
  name: string;
  isOwner: boolean;
  canPayroll: boolean;
  canEvaluation: boolean;
  note: string | null;
}

export function validateAdmin(input: AdminInput): string | null {
  if (!/^[A-Za-z0-9_@.-]{1,64}$/.test(input.loginId)) {
    return "社員番号の形式が正しくありません。";
  }
  if (!input.name.trim()) return "お名前は必須です。";
  return null;
}

/** 名簿に追加（既にいれば権限を更新する）。 */
export async function upsertAdmin(input: AdminInput, createdBy: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO jinji_admins (login_id, name, is_owner, can_payroll, can_evaluation, note, created_by)
    VALUES (${input.loginId}, ${input.name}, ${input.isOwner}, ${input.canPayroll},
            ${input.canEvaluation}, ${input.note}, ${createdBy})
    ON CONFLICT (login_id) DO UPDATE SET
      name = EXCLUDED.name,
      is_owner = EXCLUDED.is_owner,
      can_payroll = EXCLUDED.can_payroll,
      can_evaluation = EXCLUDED.can_evaluation,
      note = EXCLUDED.note`;
}

/**
 * 名簿から外す。
 * 最後の owner は外せない（誰も名簿を編集できなくなり、締め出されるため）。
 */
export async function removeAdmin(loginId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const target = await sql`SELECT is_owner FROM jinji_admins WHERE login_id = ${loginId} LIMIT 1`;
  if (target.length === 0) return;
  if (target[0].is_owner) {
    const owners = await countOwners();
    if (owners <= 1) {
      throw new Error("最後の責任者（owner）は名簿から外せません。先に別の責任者を追加してください。");
    }
  }
  await sql`DELETE FROM jinji_admins WHERE login_id = ${loginId}`;
}

/** owner を外すときも、最後の1人でないことを確認する。 */
export async function assertNotLastOwner(loginId: string, willBeOwner: boolean): Promise<void> {
  if (willBeOwner) return;
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT is_owner FROM jinji_admins WHERE login_id = ${loginId} LIMIT 1`;
  if (cur.length === 0 || !cur[0].is_owner) return;
  const owners = await countOwners();
  if (owners <= 1) {
    throw new Error("最後の責任者（owner）の権限は外せません。先に別の責任者を追加してください。");
  }
}

/**
 * 利用者のパスワード設定リンクを発行する。
 * ログインアカウントが無ければ招待ユーザーとして作ってからリンクを出す
 * （名簿には載っているがアカウントが無い、という状態を解消できるように）。
 */
export async function issuePasswordLink(loginId: string, name: string): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  let rows = await sql`SELECT id FROM users WHERE login_id = ${loginId} LIMIT 1`;
  if (rows.length === 0) {
    const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
    await createInvitedUser(companyId, loginId, null, name, "admin");
    rows = await sql`SELECT id FROM users WHERE login_id = ${loginId} LIMIT 1`;
  }
  const userId = rows[0].id as string;
  const token = generateResetToken();
  await sql`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashResetToken(token)}, NOW() + make_interval(mins => ${7 * 24 * 60}))`;
  return `${resetLinkBase()}/password-reset/confirm?token=${token}`;
}

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getSql } from "./neon";

/**
 * 認証用テーブル（companies/users）を冪等に作成。
 *
 * 形は PFシリーズ共通（pf-tenchu 等と同一）にしてある。ポータルからの SSO・
 * プロビジョニングが同じ列を前提にしているため、独自DBでも列構成は揃える。
 * 人事ドメインのテーブル（jinji_*）は schema.ts 側で作る。
 */
export async function ensureAuthSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      email         TEXT UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS users_company_id_idx ON users(company_id)`;
  // 「管理者がアカウントを発行する」モデル用の列（冪等追加）。
  // pending=true は招待済み・パスワード未設定。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT false`;
  // ポータル由来の部署名（ポータル側の部署が「工場」種別のときだけ値が入る）。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS factory TEXT`;
  // ポータルで指定された承認者の login_id。本アプリでは未使用だが契約互換のため保持する。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS approver_login_id TEXT`;
  // ポータルの設定担当者フラグ（pf_portal_users.can_manage）。SSO とプロビジョニングの
  // 両方から届き、本アプリの入室可否をこれと role で判定する（lib/session.ts）。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage BOOLEAN NOT NULL DEFAULT false`;
  // 社員番号ログイン用。email は任意項目。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_idx ON users(login_id)`;
  await sql`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`;
  await bootstrapUnifiedAdmin(sql);
}

// 統一管理者ブートストラップの固定値（PF社内展開・全アプリ共通）
const BOOTSTRAP_ADMIN_LOGIN_ID = "admin";
export const BOOTSTRAP_COMPANY_NAME = "株式会社パロマ";
const BOOTSTRAP_ADMIN_NAME = "管理者";

/**
 * 実運用の会社「株式会社パロマ」を名前で get-or-create して id を返す。
 * 同名が複数あっても最古の1社に寄せる。
 */
export async function getOrCreateCompanyByName(name: string): Promise<string> {
  const sql = getSql();
  const rows = await sql`
    SELECT id FROM companies WHERE name = ${name} ORDER BY created_at ASC LIMIT 1`;
  const existing = rows[0]?.id as string | undefined;
  if (existing) return existing;
  const created = await sql`INSERT INTO companies (name) VALUES (${name}) RETURNING id`;
  return created[0].id as string;
}

/**
 * 統一管理者（login_id='admin'）のブートストラップ。
 * PF_ADMIN_BOOTSTRAP_HASH（bcryptハッシュ）を設定した環境でのみ動作し、既に居れば何もしない。
 * 失敗しても throw しない（呼び出し元の通常処理を止めない）。
 */
async function bootstrapUnifiedAdmin(sql: ReturnType<typeof getSql>): Promise<void> {
  const hash = (process.env.PF_ADMIN_BOOTSTRAP_HASH ?? "").trim();
  if (!hash) return;
  try {
    const exists = await sql`SELECT 1 FROM users WHERE login_id = ${BOOTSTRAP_ADMIN_LOGIN_ID} LIMIT 1`;
    if (exists.length > 0) return;
    const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
    await sql`
      INSERT INTO users (company_id, login_id, email, name, password_hash, role, pending)
      VALUES (${companyId}, ${BOOTSTRAP_ADMIN_LOGIN_ID}, ${null},
              ${BOOTSTRAP_ADMIN_NAME}, ${hash}, 'admin', false)
      ON CONFLICT DO NOTHING`;
  } catch (e) {
    console.warn("[auth] unified admin bootstrap failed (continuing):", (e as Error).message);
  }
}

/** 社員番号の重複チェック */
export async function loginIdExists(loginId: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`SELECT 1 FROM users WHERE login_id = ${loginId} LIMIT 1`;
  return rows.length > 0;
}

/** パスワード設定済みのユーザーを作成し id を返す。 */
export async function createUser(
  companyId: string,
  loginId: string,
  email: string | null,
  name: string,
  password: string,
  role: "admin" | "member" = "member",
): Promise<string> {
  const sql = getSql();
  const hash = await bcrypt.hash(password, 10);
  const rows = await sql`
    INSERT INTO users (company_id, login_id, email, name, password_hash, role, pending)
    VALUES (${companyId}, ${loginId}, ${email}, ${name}, ${hash}, ${role}, false)
    RETURNING id`;
  return rows[0].id as string;
}

/**
 * 招待ユーザー（パスワード未設定）を作成し id を返す。
 * password_hash は NOT NULL のため、ログインに使えないランダム値を入れておく。
 */
export async function createInvitedUser(
  companyId: string,
  loginId: string,
  email: string | null,
  name: string,
  role: "admin" | "member" = "member",
): Promise<string> {
  const sql = getSql();
  const unusable = crypto.randomBytes(32).toString("hex");
  const rows = await sql`
    INSERT INTO users (company_id, login_id, email, name, password_hash, role, pending)
    VALUES (${companyId}, ${loginId}, ${email}, ${name}, ${unusable}, ${role}, true)
    RETURNING id`;
  return rows[0].id as string;
}

/** 社員番号でユーザーの表示名を引く（承認者名の解決などに使う）。 */
export async function getUserNameByLoginId(loginId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`SELECT name FROM users WHERE login_id = ${loginId} LIMIT 1`;
  return (rows[0]?.name as string | undefined) ?? null;
}

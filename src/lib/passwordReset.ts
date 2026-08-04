import crypto from "crypto";
import { getSql } from "./neon";

/**
 * パスワード設定／再設定トークン。
 * - 生トークンはリンクにのみ載せ、DB には SHA-256 ハッシュだけ保存する
 *   （DB が読まれてもトークンを再現できない）。
 * - 使い捨て（used_at 記録）。
 */

export const RESET_TOKEN_TTL_MINUTES = 60;

/** password_reset_tokens テーブルを冪等に作成。 */
export async function ensurePasswordResetSchema(): Promise<void> {
  const sql = getSql();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
      ON password_reset_tokens(user_id)`;
  } catch {
    /* 同時初回アクセスのカタログ競合（42P07 等）は無視 */
  }
}

/** 再設定トークンを新規発行（戻り値はリンクに載せる生トークン）。 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** DB 保存・照合用の SHA-256 ハッシュ。 */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** リンクの base URL（NEXTAUTH_URL 優先・末尾スラッシュは除去）。 */
export function resetLinkBase(): string {
  const base = process.env.NEXTAUTH_URL || "https://jinji.paloma-pf.com";
  return base.replace(/\/+$/, "");
}

/**
 * トークンを検証してパスワードを設定する。
 * 有効なら true、期限切れ・使用済み・不明なトークンなら false。
 */
export async function consumeResetToken(token: string, passwordHash: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, user_id FROM password_reset_tokens
    WHERE token_hash = ${hashResetToken(token)}
      AND used_at IS NULL
      AND expires_at > NOW()
    LIMIT 1`;
  const t = rows[0];
  if (!t) return false;
  await sql.transaction([
    sql`UPDATE users SET password_hash = ${passwordHash}, pending = false WHERE id = ${t.user_id}`,
    sql`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ${t.id}`,
  ]);
  return true;
}

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createInvitedUser, getOrCreateCompanyByName, BOOTSTRAP_COMPANY_NAME } from "@/lib/authDb";
import { getSql } from "@/lib/neon";
import { ensureSchema } from "@/lib/schema";
import { generateResetToken, hashResetToken, resetLinkBase } from "@/lib/passwordReset";

export const runtime = "nodejs";

/**
 * ポータルからの一括アカウント発行API（内部用・UIなし）。
 * 認証はセッションではなく共有キー PF_PROVISION_KEY（未設定なら 503 で無効化）。
 * PFシリーズ共通契約 v2.1（passwordSet を返す）。
 *
 * ※ここで発行されるのは**ログインできるアカウント**まで。人事情報を扱えるかどうかは
 *   利用許可名簿（jinji_admins）で別に決まる。ポータルが全員を送ってきても、
 *   名簿に載せていない限り誰も人事情報にはアクセスできない。
 */

// 招待リンクの有効期限は他アプリと同じ7日
const INVITE_TOKEN_TTL_MINUTES = 7 * 24 * 60;
// 1リクエストで発行できる上限件数
const MAX_USERS_PER_REQUEST = 200;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
// 社員番号は半角英数と - _ のみ（1〜64文字）
const isLoginId = (s: string) => /^[A-Za-z0-9_-]{1,64}$/.test(s);

/** タイミング安全なキー比較（長さ違いは即 false 扱い）。 */
function safeKeyEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type ProvisionResult = {
  loginId: string;
  status: "created" | "exists" | "error";
  passwordSet?: boolean;
  inviteUrl?: string;
  message?: string;
};

export async function POST(req: Request) {
  const provisionKey = process.env.PF_PROVISION_KEY;
  if (!provisionKey) {
    return NextResponse.json({ message: "provision未設定" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  if (!safeKeyEqual(key, provisionKey)) {
    return NextResponse.json({ message: "認証に失敗しました。" }, { status: 401 });
  }

  const users = body.users;
  if (!Array.isArray(users) || users.length === 0) {
    return NextResponse.json({ message: "users を指定してください。" }, { status: 400 });
  }
  if (users.length > MAX_USERS_PER_REQUEST) {
    return NextResponse.json(
      { message: `一度に発行できるのは最大${MAX_USERS_PER_REQUEST}件です。` },
      { status: 400 },
    );
  }
  const regenerateLinks = body.regenerateLinks === true;

  try {
    await ensureSchema();
    const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
    const sql = getSql();

    const results: ProvisionResult[] = [];
    for (const u of users) {
      const loginId = (u?.loginId ?? "").toString().trim();
      try {
        if (!isLoginId(loginId)) {
          results.push({
            loginId,
            status: "error",
            message: "社員番号は半角英数字とハイフン・アンダースコア（1〜64文字）で入力してください。",
          });
          continue;
        }
        if (loginId === "admin") {
          results.push({ loginId, status: "error", message: "社員番号 'admin' は発行できません。" });
          continue;
        }
        const name = (u?.name ?? "").toString().trim();
        const email = ((u?.email ?? "").toString().trim().toLowerCase() as string) || null;
        // 役割は 管理者(admin) / 一般(member) の2種。未知の値は member に丸める。
        const role: "admin" | "member" = u?.role === "admin" ? "admin" : "member";
        // ポータルの設定担当者フラグ。本アプリの入室可否に効く（lib/session.ts）。
        // 契約に無い旧ポータルからは届かないので、その場合は false（role だけで判定される）。
        const canManage = u?.canManage === true;
        if (email && (!isEmail(email) || email.length > 254)) {
          results.push({ loginId, status: "error", message: "メールアドレスの形式が正しくありません。" });
          continue;
        }
        const approverRaw = ((u?.approverLoginId ?? "") as string).toString().trim();
        if (approverRaw && !isLoginId(approverRaw)) {
          results.push({
            loginId,
            status: "error",
            message: "承認者の社員番号は半角英数字とハイフン・アンダースコア（1〜64文字）で入力してください。",
          });
          continue;
        }
        const approverLoginId: string | null = approverRaw || null;
        // ポータル由来の部署名。フィールド自体が省略されたときは既存値を変更しない
        // （部署を送らない呼び出しで、設定済みの所属を消してしまわないため）。
        const hasFactory = u != null && Object.prototype.hasOwnProperty.call(u, "factory");
        const factory = hasFactory ? ((u?.factory ?? "").toString().trim() || null) : null;

        const existing = await sql`SELECT id, pending FROM users WHERE login_id = ${loginId} LIMIT 1`;
        if (existing.length > 0) {
          const userId = existing[0].id as string;
          await sql`
            UPDATE users SET
              name = COALESCE(NULLIF(${name}, ''), name),
              role = ${role},
              can_manage = ${canManage},
              approver_login_id = ${approverLoginId},
              email = COALESCE(${email}, email)
            WHERE id = ${userId}`;
          if (hasFactory) {
            await sql`UPDATE users SET factory = ${factory} WHERE id = ${userId}`;
          }
          // 人事マスターに同じ社員番号が居れば、氏名だけポータルの最新に寄せる
          // （所属・役職は異動申請を通した結果が正なので、ここでは触らない）。
          if (name) {
            await sql`
              UPDATE jinji_employees SET name = ${name}, updated_at = NOW()
              WHERE employee_no = ${loginId} AND name <> ${name}`;
          }
          if (!regenerateLinks) {
            results.push({ loginId, status: "exists", passwordSet: !existing[0].pending });
            continue;
          }
          const token = generateResetToken();
          await sql`
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            VALUES (${userId}, ${hashResetToken(token)},
                    NOW() + make_interval(mins => ${INVITE_TOKEN_TTL_MINUTES}))`;
          results.push({
            loginId,
            status: "exists",
            passwordSet: !existing[0].pending,
            inviteUrl: `${resetLinkBase()}/password-reset/confirm?token=${token}`,
          });
          continue;
        }

        if (!name) {
          results.push({ loginId, status: "error", message: "お名前を入力してください。" });
          continue;
        }

        const userId = await createInvitedUser(companyId, loginId, email, name, role);
        await sql`UPDATE users SET can_manage = ${canManage} WHERE id = ${userId}`;
        if (approverLoginId) {
          await sql`UPDATE users SET approver_login_id = ${approverLoginId} WHERE id = ${userId}`;
        }
        if (factory) {
          await sql`UPDATE users SET factory = ${factory} WHERE id = ${userId}`;
        }
        const token = generateResetToken();
        await sql`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${userId}, ${hashResetToken(token)},
                  NOW() + make_interval(mins => ${INVITE_TOKEN_TTL_MINUTES}))`;
        results.push({
          loginId,
          status: "created",
          passwordSet: false,
          inviteUrl: `${resetLinkBase()}/password-reset/confirm?token=${token}`,
        });
      } catch (e) {
        results.push({ loginId, status: "error", message: (e as Error).message });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[provision] error:", err);
    return NextResponse.json({ message: "一括発行に失敗しました。" }, { status: 500 });
  }
}

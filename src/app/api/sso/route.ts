import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { encode } from "next-auth/jwt";
import { authOptions } from "@/lib/authOptions";
import { getSql } from "@/lib/neon";
import { ensureSchema } from "@/lib/schema";
import { getOrCreateCompanyByName, createInvitedUser, BOOTSTRAP_COMPANY_NAME } from "@/lib/authDb";
import { findGrant } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ポータルからのSSOログイン（GET /api/sso?token=...）。
 *
 * token = payload + "." + sig
 * - payload: base64url( JSON.stringify({ loginId, name, role, app, exp }) )  ※exp は epoch ms
 * - sig: payload 文字列に対する HMAC-SHA256（16進小文字）、鍵は PF_PROVISION_KEY
 *
 * PFシリーズ共通の契約（pf-tenchu 等と同一）。検証OKなら next-auth の jwt コールバックが
 * 作るのと同じ形のトークンを encode してセッションクッキーに設定する。
 *
 * ただし本アプリは管理者専用のため、**ログインさせた上で利用許可名簿を確認する**:
 * 名簿に無い社員番号は / ではなく /forbidden へ送る。名簿判定はページ側でも毎回
 * 行われる（lib/session.ts）ので、ここは案内を出すための先回りに過ぎない。
 */

const APP_KEY = "jinji";
// next-auth の session.maxAge 既定値（本アプリは未指定＝30日）
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** タイミング安全な文字列比較（長さ違いは即 false 扱い）。 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  const provisionKey = process.env.PF_PROVISION_KEY;
  if (!provisionKey) {
    return NextResponse.json({ message: "provision未設定" }, { status: 503 });
  }
  // 失敗理由はサーバーログにだけ残す。利用者への応答は理由を明かさない（従来どおり）。
  // 無言で失敗すると、鍵の不一致なのかDB断なのか運用時に切り分けられないため。
  const fail = (reason: string) => {
    console.warn("[sso] rejected:", reason);
    return NextResponse.redirect(new URL("/login?error=sso", req.nextUrl), 302);
  };

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return fail("NEXTAUTH_SECRET が未設定");

  try {
    const raw = req.nextUrl.searchParams.get("token") ?? "";
    const dot = raw.lastIndexOf(".");
    if (dot <= 0 || dot === raw.length - 1) return fail("トークンの形式が不正");
    const payload = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);

    const expected = createHmac("sha256", provisionKey).update(payload).digest("hex");
    if (!safeEqual(sig, expected)) return fail("署名が一致しない（PF_PROVISION_KEY の不一致か改ざん）");

    let data: { loginId?: unknown; name?: unknown; app?: unknown; exp?: unknown };
    try {
      data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return fail("ペイロードが JSON として読めない");
    }
    const loginId = typeof data.loginId === "string" ? data.loginId.trim() : "";
    if (!loginId) return fail("loginId が空");
    if (data.app !== APP_KEY) return fail(`別アプリ宛のトークン（app=${String(data.app)}）`);
    if (typeof data.exp !== "number" || !(data.exp > Date.now())) return fail("トークンの有効期限切れ");

    await ensureSchema();
    const sql = getSql();
    let rows = await sql`
      SELECT u.id, u.email, u.name, u.login_id,
             c.id AS company_id, c.name AS company_name
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE u.login_id = ${loginId}
      LIMIT 1
    `;
    // アプリ側にアカウントが未発行でも、ポータルが本人と保証した以上ログインさせる
    // （名簿に無ければこの後 /forbidden に送られるので、勝手に権限が増えることはない）。
    if (rows.length === 0) {
      const portalName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : loginId;
      const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
      await createInvitedUser(companyId, loginId, null, portalName, "member");
      rows = await sql`
        SELECT u.id, u.email, u.name, u.login_id,
               c.id AS company_id, c.name AS company_name
        FROM users u
        JOIN companies c ON c.id = u.company_id
        WHERE u.login_id = ${loginId}
        LIMIT 1
      `;
    }
    const user = rows[0];
    if (!user) return fail("アカウントを作成できなかった");

    // authorize → jwt コールバック通過後と同一フィールドのトークンを構築
    const sessionToken = await encode({
      token: {
        name: user.name as string,
        email: (user.email as string | null) ?? "",
        sub: user.id as string,
        id: user.id as string,
        loginId: (user.login_id as string | null) ?? loginId,
        companyId: user.company_id as string,
        companyName: user.company_name as string,
      },
      secret,
      maxAge: SESSION_MAX_AGE,
    });

    // 名簿に無ければ、入口で理由を見せる（ページ側でも同じ判定が毎回走る）
    const grant = await findGrant(loginId);
    const dest = grant ? "/" : "/forbidden";

    // クッキー名・属性は authOptions.cookies と完全に同一にする（getServerSession が読む名前）
    const cookie = authOptions.cookies!.sessionToken!;
    const res = NextResponse.redirect(new URL(dest, req.nextUrl), 302);
    res.cookies.set(cookie.name, sessionToken, {
      ...cookie.options,
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (e) {
    // DB断など。理由が分からないと運用時に切り分けられないので必ず残す。
    return fail(`処理中に例外: ${(e as Error).message}`);
  }
}

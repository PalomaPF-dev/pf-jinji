import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getSql } from "./neon";

// localhost のクッキーはポートを跨いで共有されるため、既定名（next-auth.session-token）のままだと
// 他のPFアプリの開発サーバーと相互上書きになり JWEDecryptionFailed が起きる。
// アプリ固有のクッキー名にして分離する（本番でも無害）。
const useSecureCookies =
  (process.env.NEXTAUTH_URL ?? "").startsWith("https://") || process.env.VERCEL === "1";
const securePrefix = useSecureCookies ? "__Secure-" : "";

/**
 * next-auth 設定（PFシリーズ共通：社員番号＋パスワード／Neon の users・companies）。
 * セッションは JWT。
 *
 * ここを通れるのは「ログインできる人」まで。人事情報を扱えるかどうかは
 * lib/session.ts の利用許可名簿（jinji_admins）で別途判定する。
 */
export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: `${securePrefix}jinji.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: `${securePrefix}jinji.callback-url`,
      options: { sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    csrfToken: {
      // CSRF トークンの既定名は __Host- プレフィックス。他アプリとの衝突回避で名前だけ変える。
      name: `${useSecureCookies ? "__Host-" : ""}jinji.csrf-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        // フィールド名は next-auth の慣例で email のまま（中身は社員番号）
        email: { label: "社員番号", type: "text" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const sql = getSql();
        const rawId = credentials.email.trim();
        // ポータル一本化: 一般利用者のログインはポータルの一括ログイン（/api/sso）に集約した。
        // パスワードでの直接ログインは、ポータル・SSO障害時の復旧用に統一管理者（admin）だけ許す。
        if (rawId.toLowerCase() !== "admin") {
          throw new Error(
            "ログインはポータルから行ってください。ポータルでログインすると各アプリへ自動でログインされます。"
          );
        }
        let rows;
        try {
          // ① 社員番号（login_id）で検索 → ②ヒットしなければメールアドレスで検索
          rows = await sql`
            SELECT u.id, u.email, u.name, u.login_id, u.password_hash, u.pending,
                   c.id AS company_id, c.name AS company_name
            FROM users u
            JOIN companies c ON c.id = u.company_id
            WHERE u.login_id = ${rawId}
            LIMIT 1
          `;
          if (rows.length === 0) {
            rows = await sql`
              SELECT u.id, u.email, u.name, u.login_id, u.password_hash, u.pending,
                     c.id AS company_id, c.name AS company_name
              FROM users u
              JOIN companies c ON c.id = u.company_id
              WHERE u.email = ${rawId.toLowerCase()}
              LIMIT 1
            `;
          }
        } catch {
          // 新規DBで users/companies が未作成の場合などはログイン失敗扱い
          return null;
        }
        const user = rows[0];
        if (!user) return null;
        if (user.pending) {
          throw new Error("パスワードが未設定です。管理者にリンクの再発行を依頼してください");
        }
        const valid = await bcrypt.compare(credentials.password, user.password_hash as string);
        if (!valid) return null;
        return {
          id: user.id as string,
          email: (user.email as string | null) ?? "",
          name: user.name as string,
          loginId: (user.login_id as string | null) ?? "",
          companyId: user.company_id as string,
          companyName: user.company_name as string,
        };
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.loginId = user.loginId;
        token.companyId = user.companyId;
        token.companyName = user.companyName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.loginId = (token.loginId as string) ?? "";
        session.user.companyId = token.companyId as string;
        session.user.companyName = token.companyName as string;
      }
      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
};

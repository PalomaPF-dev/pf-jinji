import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSql } from "@/lib/neon";
import { ensureSchema } from "@/lib/schema";
import { createUser, getOrCreateCompanyByName, BOOTSTRAP_COMPANY_NAME } from "@/lib/authDb";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * 初期セットアップ（最初の1人だけ）。
 *
 * 利用許可名簿（jinji_admins）が空のときだけ動く。ここで登録された人が owner となり、
 * 以後の名簿追加は設定画面から行う。名簿が1件でもあれば 409 を返して何もしない
 * ＝ この経路から権限を後付けで作ることはできない。
 */

const isLoginId = (s: string) => /^[A-Za-z0-9_-]{1,64}$/.test(s);

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const sql = getSql();

    const existing = await sql`SELECT count(*)::int AS n FROM jinji_admins`;
    if ((existing[0]?.n as number) > 0) {
      return NextResponse.json(
        { message: "初期セットアップは完了しています。設定画面から利用者を追加してください。" },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const loginId = (body.loginId ?? "").toString().trim();
    const name = (body.name ?? "").toString().trim();
    const password = (body.password ?? "").toString();

    if (!isLoginId(loginId)) {
      return NextResponse.json(
        { message: "社員番号は半角英数字とハイフン・アンダースコア（1〜64文字）で入力してください。" },
        { status: 400 },
      );
    }
    if (!name) {
      return NextResponse.json({ message: "お名前を入力してください。" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "パスワードは8文字以上で設定してください。" }, { status: 400 });
    }

    // ログインアカウント: 既にあれば（ポータル発行済みなど）パスワードだけ設定し直す
    const users = await sql`SELECT id FROM users WHERE login_id = ${loginId} LIMIT 1`;
    if (users.length > 0) {
      const hash = await bcrypt.hash(password, 10);
      await sql`
        UPDATE users SET name = ${name}, password_hash = ${hash}, pending = false, role = 'admin'
        WHERE id = ${users[0].id}`;
    } else {
      const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
      await createUser(companyId, loginId, null, name, password, "admin");
    }

    // 利用許可名簿へ owner として登録。名簿が空のときだけ通す条件を INSERT にも重ねて、
    // 同時リクエストで2人目の owner が生まれないようにする。
    const inserted = await sql`
      INSERT INTO jinji_admins (login_id, name, is_owner, can_payroll, can_evaluation, note, created_by)
      SELECT ${loginId}, ${name}, true, true, true, ${"初期セットアップ"}, ${loginId}
      WHERE NOT EXISTS (SELECT 1 FROM jinji_admins)
      RETURNING login_id`;
    if (inserted.length === 0) {
      return NextResponse.json(
        { message: "初期セットアップは完了しています。設定画面から利用者を追加してください。" },
        { status: 409 },
      );
    }

    await recordAudit({
      actorLoginId: loginId,
      actorName: name,
      action: "update_admin",
      targetType: "jinji_admins",
      targetId: loginId,
      targetLabel: name,
      detail: { event: "initial_setup", isOwner: true },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[setup] error:", e);
    return NextResponse.json({ message: "初期セットアップに失敗しました。" }, { status: 500 });
  }
}

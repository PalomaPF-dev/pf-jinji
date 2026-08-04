import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ensureSchema } from "@/lib/schema";
import { consumeResetToken } from "@/lib/passwordReset";

export const runtime = "nodejs";

/**
 * パスワード設定リンクの確定（POST {token, password}）。
 * トークンは使い捨て・期限つき。成功すると pending が解除されログインできるようになる。
 */
export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const token = (body.token ?? "").toString().trim();
    const password = (body.password ?? "").toString();

    if (!token) {
      return NextResponse.json({ message: "リンクが正しくありません。" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "パスワードは8文字以上で設定してください。" }, { status: 400 });
    }

    const ok = await consumeResetToken(token, await bcrypt.hash(password, 10));
    if (!ok) {
      return NextResponse.json(
        { message: "リンクの有効期限が切れているか、既に使用されています。再発行を依頼してください。" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[password-reset/confirm] error:", e);
    return NextResponse.json({ message: "パスワードの設定に失敗しました。" }, { status: 500 });
  }
}

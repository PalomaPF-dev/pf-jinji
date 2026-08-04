import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { listQualifications } from "@/lib/qualifications";
import { listDueTransfers } from "@/lib/transfers";
import { alertLeadDays, daysUntil, todayJST } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 日次の点検（Vercel Cron から叩く）。
 *
 * - 資格の有効期限が ALERT_LEAD_DAYS（既定 90/30/7 日前）に当たるもの
 * - 期限が既に切れているもの
 * - 承認済みなのに適用日を過ぎても人事マスターへ未反映の異動
 *
 * メール送信はこのアプリでは持たない（利用者が人事担当者に限られ、
 * ダッシュボードで足りるため）。結果はレスポンスとログに出し、
 * 通知が必要になった時点で送信先を足せる形にしてある。
 *
 * 認証は CRON_SECRET の Bearer トークン。未設定なら 503 で無効化する
 * （誰でも叩ける状態で人事情報の件数を晒さないため）。
 */
function authorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!(process.env.CRON_SECRET ?? "").trim()) {
    return NextResponse.json({ message: "CRON_SECRET が未設定です" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ message: "認証に失敗しました" }, { status: 401 });
  }

  try {
    const today = todayJST();
    const leadDays = alertLeadDays();

    const quals = await listQualifications({});
    const expired: { employee: string; name: string; expiresOn: string; daysOver: number }[] = [];
    const upcoming: { employee: string; name: string; expiresOn: string; daysLeft: number }[] = [];

    for (const q of quals) {
      if (!q.expiresOn) continue;
      const d = daysUntil(q.expiresOn, today);
      if (d < 0) {
        expired.push({ employee: q.employeeName, name: q.name, expiresOn: q.expiresOn, daysOver: -d });
      } else if (leadDays.includes(d)) {
        upcoming.push({ employee: q.employeeName, name: q.name, expiresOn: q.expiresOn, daysLeft: d });
      }
    }

    const due = (await listDueTransfers(today)).map((t) => ({
      transferNo: t.transferNo,
      employee: t.employeeName,
      effectiveDate: t.effectiveDate,
    }));

    const summary = {
      today,
      leadDays,
      expiredQualifications: expired.length,
      upcomingQualifications: upcoming.length,
      unappliedTransfers: due.length,
    };
    console.log("[cron/alerts]", JSON.stringify(summary));

    return NextResponse.json({ ok: true, ...summary, expired, upcoming, due });
  } catch (e) {
    console.error("[cron/alerts] error:", e);
    return NextResponse.json({ message: "点検に失敗しました" }, { status: 500 });
  }
}

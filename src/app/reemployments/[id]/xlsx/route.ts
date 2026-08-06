import { NextResponse } from "next/server";
import { requireJinjiSession } from "@/lib/session";
import { getReemployment } from "@/lib/reemployments";
import { buildReemploymentXlsx, reemploymentXlsxName } from "@/lib/formXlsx";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** ファイル名の ASCII 代替（非ASCIIは _ にする）。 */
const asciiName = (v: string): string => v.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");

/**
 * 継続雇用申請書を指定帳票（J-456）の Excel で落とす。
 * 原紙に値を差し込んで返すので、様式は原紙のまま。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireJinjiSession();
  const { id } = await params;
  const r = await getReemployment(id);
  if (!r) return new NextResponse("見つかりません", { status: 404 });

  const file = buildReemploymentXlsx(r);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_reemployment",
    targetType: "reemployment",
    targetId: r.id,
    targetLabel: `${r.docNo} をExcelで出力`,
  });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 日本語のファイル名は filename* で渡す。素の filename も置くのは、
      // 古いブラウザが filename* を無視して名無しで落としてしまうため。
      "Content-Disposition":
        `attachment; filename="${asciiName(reemploymentXlsxName(r))}"; ` +
        `filename*=UTF-8''${encodeURIComponent(reemploymentXlsxName(r))}`,
      "Cache-Control": "no-store",
    },
  });
}

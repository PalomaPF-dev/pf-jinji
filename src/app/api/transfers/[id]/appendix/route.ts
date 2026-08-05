import { NextRequest, NextResponse } from "next/server";
import { getOptionalGrant } from "@/lib/session";
import { getScope, inScope } from "@/lib/scope";
import { getTransfer, listTransferItems } from "@/lib/transfers";
import { APPENDIX_HEADERS, buildAppendixRows } from "@/lib/transferAppendix";
import { buildXlsx } from "@/lib/xlsxWrite";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 一括異動申請の別紙（異動者一覧）を Excel でダウンロードする。
 * CSV にしないのは、社員番号・組織コードの先頭ゼロが Excel で落ちるため。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const grant = await getOptionalGrant();
  if (!grant) {
    return NextResponse.json({ message: "このアプリの利用が許可されていません。" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const t = await getTransfer(id);
  if (!t || !t.isBulk) {
    return NextResponse.json({ message: "一括申請が見つかりません。" }, { status: 404 });
  }

  // 管理者は自分の工場の申請だけ（一覧と同じ範囲）
  const scope = await getScope(grant);
  if (scope.orgUnitIds !== null) {
    const items = await listTransferItems(id);
    const visible = items.some(
      (i) => inScope(scope, i.fromOrgUnitId) || inScope(scope, i.toOrgUnitId),
    );
    if (!visible) return NextResponse.json({ message: "対象が見つかりません。" }, { status: 404 });
  }

  const rows = await buildAppendixRows(id);
  const xlsx = buildXlsx([
    {
      name: "異動一覧",
      rows: [
        [...APPENDIX_HEADERS],
        ...rows.map((r) => [
          r.factory,
          r.effectiveDate,
          r.employeeNo,
          r.employeeName,
          r.fromCode,
          r.fromPath,
          r.toCode,
          r.toName,
          r.reason,
        ]),
      ],
      colWidths: [10, 10, 10, 16, 12, 52, 14, 24, 28],
    },
  ]);

  await recordAudit({
    actorLoginId: grant.loginId,
    actorName: grant.name,
    action: "update_transfer",
    targetType: "transfer",
    targetId: id,
    targetLabel: `${t.transferNo} 別紙のExcel出力`,
    detail: { count: rows.length },
  });

  const ascii = `${t.transferNo}-list.xlsx`;
  const utf8 = encodeURIComponent(`異動申請書別紙_${t.transferNo}.xlsx`);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      "Cache-Control": "no-store",
    },
  });
}

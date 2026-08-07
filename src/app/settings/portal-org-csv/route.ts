import { NextResponse } from "next/server";
import { requireOwnerSession } from "@/lib/session";
import {
  buildPortalOrgExport,
  departmentsCsv,
  workplacesCsv,
} from "@/lib/portalOrgCsv";

export const dynamic = "force-dynamic";

/**
 * ポータルの「CSVで一括設定」に入れる部署・職場の一覧を落とす。
 *
 *   /settings/portal-org-csv?kind=dept      … 部署CSV
 *   /settings/portal-org-csv?kind=workplace … 職場CSV
 *
 * 連携で部署を作らないのは、ポータル側のアプリ割当を人事が上書きしないため。
 * 一覧だけ渡して、設定はポータルでしてもらう。
 */
export async function GET(req: Request) {
  await requireOwnerSession();
  const kind = new URL(req.url).searchParams.get("kind") === "workplace" ? "workplace" : "dept";
  const x = await buildPortalOrgExport();
  const body = kind === "workplace" ? workplacesCsv(x) : departmentsCsv(x);
  const name = kind === "workplace" ? "portal-workplaces.csv" : "portal-departments.csv";

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

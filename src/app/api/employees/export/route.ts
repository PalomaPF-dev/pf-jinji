import { NextRequest, NextResponse } from "next/server";
import { getOptionalGrant } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { recordAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { EMPLOYEE_CSV_HEADERS, employeeToCsvRow, listEmployees } from "@/lib/employees";
import { listOrgUnits } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import type { EmploymentStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 社員台帳のCSV出力。一覧と同じ絞り込みを効かせる。
 * 給与・考課は含めない（この出力は所属・処遇までの台帳）。
 */
export async function GET(req: NextRequest) {
  const grant = await getOptionalGrant();
  if (!grant) {
    return NextResponse.json({ message: "このアプリの利用が許可されていません。" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const org = req.nextUrl.searchParams.get("org") ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? "active";
  const scope = await getScope(grant);

  const [employees, orgUnits] = await Promise.all([
    listEmployees({
      q,
      orgUnitId: org || null,
      status: (status === "all" ? "all" : status) as EmploymentStatus | "all",
      scopeOrgIds: scope.orgUnitIds,
    }),
    listOrgUnits(),
  ]);
  const orgCodeById = new Map(orgUnits.map((o) => [o.id, o.code]));

  const csv = toCsv(
    [...EMPLOYEE_CSV_HEADERS],
    employees.map((e) => employeeToCsvRow(e, orgCodeById)),
  );

  await recordAudit({
    actorLoginId: grant.loginId,
    actorName: grant.name,
    action: "update_employee",
    targetType: "employee",
    targetLabel: "CSV出力",
    detail: { count: employees.length, q, org, status },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="employees-${todayJST()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

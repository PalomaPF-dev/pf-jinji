import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getEmployee } from "@/lib/employees";
import { todayJST } from "@/lib/dates";
import { ageAt, formatDate, tenureAt } from "@/lib/format";
import { EmploymentStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import { GENDER_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-[#f0f0f0] py-2.5 last:border-0">
      <dt className="w-28 shrink-0 text-xs text-[#909090]">{label}</dt>
      <dd className="text-sm text-[#333333]">{value ?? "—"}</dd>
    </div>
  );
}

/** 社員カード。基本情報に加え、異動履歴・考課・給与・資格へ導線を出す。 */
export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireJinjiSession();
  const { id } = await params;
  const e = await getEmployee(id);
  if (!e) notFound();
  const today = todayJST();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title={e.name}
        description={`${e.employeeNo}${e.nameKana ? ` / ${e.nameKana}` : ""}`}
        backHref="/employees"
        backLabel="社員台帳へ戻る"
        actions={
          <Link
            href={`/employees/${e.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <Pencil className="h-4 w-4" />
            編集
          </Link>
        }
      />

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">基本情報</h2>
          <dl>
            <Row label="在籍状態" value={<EmploymentStatusBadge status={e.status} />} />
            <Row label="性別" value={e.gender ? GENDER_LABEL[e.gender] : "—"} />
            <Row
              label="生年月日"
              value={
                e.birthDate ? `${formatDate(e.birthDate)}（${ageAt(e.birthDate, today) ?? "—"}歳）` : "—"
              }
            />
            <Row
              label="入社日"
              value={e.hireDate ? `${formatDate(e.hireDate)}（勤続 ${tenureAt(e.hireDate, today)}）` : "—"}
            />
            {e.status === "retired" && <Row label="退職日" value={formatDate(e.retireDate)} />}
            <Row label="雇用体系" value={e.employmentType ?? "—"} />
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">所属・処遇</h2>
          <dl>
            <Row label="所属" value={e.orgUnitName ?? "（未配置）"} />
            <Row label="役職" value={e.positionName ?? "—"} />
            <Row label="職務" value={e.dutyName ?? "—"} />
            <Row label="等級" value={e.grade ?? "—"} />
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">連絡先</h2>
          <dl>
            <Row label="メール" value={e.email ?? "—"} />
            <Row label="電話" value={e.phone ?? "—"} />
            <Row label="備考" value={e.note ? <span className="whitespace-pre-wrap">{e.note}</span> : "—"} />
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">関連情報</h2>
          <div className="space-y-2">
            <Link
              href={`/transfers?employee=${e.id}`}
              className="block rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
            >
              異動履歴を見る
            </Link>
            <Link
              href={`/qualifications?employee=${e.id}`}
              className="block rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
            >
              保有資格を見る
            </Link>
            {s.grant.canEvaluation && (
              <Link
                href={`/evaluations?employee=${e.id}`}
                className="block rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
              >
                人事考課を見る
              </Link>
            )}
            {s.grant.canPayroll && (
              <Link
                href={`/salaries/${e.id}`}
                className="block rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
              >
                基本給与を見る
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

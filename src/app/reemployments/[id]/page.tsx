import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSpreadsheet, Pencil, Printer } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getReemployment, listReemploymentApprovals } from "@/lib/reemployments";
import { getEmployee } from "@/lib/employees";
import { formatDate } from "@/lib/format";
import { ReemploymentStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import {
  DeleteReemploymentForm,
  ReemploymentApprovalPanel,
  SubmitReemploymentForm,
} from "@/components/ReemploymentWorkflow";
import { REEMPLOYMENT_REASON_HEADINGS, actualWorkHours, ageAt } from "@/lib/types";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-[#f0f0f0] py-2.5 last:border-0">
      <dt className="w-28 shrink-0 text-xs text-[#909090]">{label}</dt>
      <dd className="text-sm text-[#333333]">{value}</dd>
    </div>
  );
}

/** 継続雇用申請（J-456）の詳細。状態に応じて申請・承認の導線を出す。 */
export default async function ReemploymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await requireJinjiSession();
  const { id } = await params;
  const r = await getReemployment(id);
  if (!r) notFound();
  const [approvals, employee] = await Promise.all([
    listReemploymentApprovals(id),
    getEmployee(r.employeeId),
  ]);
  const editable = r.status === "draft" || r.status === "rejected";
  const age = ageAt(employee?.birthDate ?? null, r.contractEndDate);
  const actual = actualWorkHours(r.workStart, r.workEnd, r.breakHours);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title={r.docNo}
        description={`${r.employeeName}（${r.employeeNo}） / 継続雇用申請書 J-456`}
        backHref="/reemployments"
        backLabel="一覧へ戻る"
        actions={
          <>
            {/* 指定帳票そのもの。原紙のExcelに値を差し込んだものを本命の出力にしている */}
            <a
              href={`/reemployments/${r.id}/xlsx`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              <FileSpreadsheet className="h-4 w-4" />
              申請書をExcelで出力
            </a>
            <Link
              href={`/reemployments/${r.id}/print`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Printer className="h-4 w-4" />
              申請書を印刷
            </Link>
            {editable && (
              <Link
                href={`/reemployments/${r.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
              >
                <Pencil className="h-4 w-4" />
                編集
              </Link>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#e5e5e5] bg-white p-4">
        <ReemploymentStatusBadge status={r.status} />
        <span className="text-xs text-[#707070]">
          この帳票は承認までで完結します（人事マスターへの自動反映はありません）。
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && <SubmitReemploymentForm id={r.id} />}
          {/* 起案中・差戻は誰でも、申請中・承認済はポータル管理者だけ消せる */}
          {(editable || s.grant.isOwner) && (
            <DeleteReemploymentForm id={r.id} name={r.employeeName} />
          )}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">対象者情報</h2>
          <dl>
            <Row
              label="氏名"
              value={
                <Link href={`/employees/${r.employeeId}`} className="text-[#2563eb] hover:underline">
                  {r.employeeName}
                </Link>
              }
            />
            <Row label="所属" value={r.orgUnitName ?? "—"} />
            <Row label="現在の雇用形態" value={r.currentEmploymentType ?? "—"} />
            <Row label="契約満了日" value={formatDate(r.contractEndDate)} />
            <Row label="年齢" value={age === null ? "—" : `${age}歳`} />
            <Row label="起案者" value={r.draftedName ?? "—"} />
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">申請内容</h2>
          <dl>
            <Row label="雇用形態" value={r.employmentType ?? "—"} />
            <Row
              label="契約期間"
              value={
                r.periodFrom || r.periodTo
                  ? `${formatDate(r.periodFrom)} 〜 ${formatDate(r.periodTo)}`
                  : "—"
              }
            />
            <Row label="勤務地" value={r.workPlace ?? "—"} />
            <Row label="勤務日数" value={r.daysPerWeek === null ? "—" : `週 ${r.daysPerWeek} 日`} />
            <Row
              label="勤務時間"
              value={
                r.workStart && r.workEnd
                  ? `${r.workStart} 〜 ${r.workEnd}（休憩 ${r.breakHours ?? 0} 時間・実働 ${actual ?? "—"} 時間）`
                  : "—"
              }
            />
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5 md:col-span-2">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">業務内容</h2>
          <ol className="space-y-1 text-sm text-[#333333]">
            {r.duties.map((d, i) =>
              d.trim() ? (
                <li key={i}>
                  <span className="mr-1 text-[#909090]">{["①", "②", "③"][i]}</span>
                  <span className="whitespace-pre-wrap">{d}</span>
                </li>
              ) : null,
            )}
            {r.duties.every((d) => !d.trim()) && <li className="text-[#909090]">—</li>}
          </ol>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5 md:col-span-2">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">継続雇用の理由・必要性</h2>
          <dl>
            {REEMPLOYMENT_REASON_HEADINGS.map((heading, i) => (
              <Row
                key={heading}
                label={`${["①", "②", "③", "④"][i]} ${heading}`}
                value={
                  r.reasons[i]?.trim() ? (
                    <span className="whitespace-pre-wrap">{r.reasons[i]}</span>
                  ) : (
                    "—"
                  )
                }
              />
            ))}
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5 md:col-span-2">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">コンプライアンス確認・結論</h2>
          <dl>
            <Row label="コンプライアンス確認" value={r.compliance ?? "—"} />
            <Row label="結論" value={r.conclusion ?? "—"} />
          </dl>
        </section>

        <div className="md:col-span-2">
          <ReemploymentApprovalPanel reemployment={r} approvals={approvals} />
        </div>
      </div>
    </div>
  );
}

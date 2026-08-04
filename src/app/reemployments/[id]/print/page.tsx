import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getReemployment, listReemploymentApprovals } from "@/lib/reemployments";
import { getEmployee } from "@/lib/employees";
import { formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";
import {
  REEMPLOYMENT_FIXED_TEXT,
  REEMPLOYMENT_REASON_HEADINGS,
  REEMPLOYMENT_TYPES,
  actualWorkHours,
  ageAt,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 指定帳票 **J-456「高齢者雇用・アルバイト契約満了に伴う継続雇用申請書」** の
 * 印刷ページ（A4縦）。実物のExcelの並び・文言をそのまま再現している。
 *
 * 雇用形態は実物が「高齢者雇用（有期契約）継続　・　アルバイト雇用契約」と
 * 両方を刷って該当を丸で囲む形なので、選ばれた側に下線を引いて印刷する。
 */
export default async function ReemploymentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireJinjiSession();
  const { id } = await params;
  const r = await getReemployment(id);
  if (!r) notFound();
  const [approvals, employee] = await Promise.all([
    listReemploymentApprovals(id),
    getEmployee(r.employeeId),
  ]);
  const age = ageAt(employee?.birthDate ?? null, r.contractEndDate);
  const actual = actualWorkHours(r.workStart, r.workEnd, r.breakHours);

  const years =
    r.periodFrom && r.periodTo
      ? Math.round(
          ((new Date(r.periodTo).getTime() - new Date(r.periodFrom).getTime()) /
            (365.25 * 24 * 3600 * 1000)) *
            10,
        ) / 10
      : null;

  return (
    <div className="mx-auto max-w-[210mm] px-4 py-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link
          href={`/reemployments/${r.id}`}
          className="inline-flex items-center gap-1 text-sm text-[#707070] hover:text-[#333333]"
        >
          <ArrowLeft className="h-4 w-4" />
          申請書へ戻る
        </Link>
        <PrintButton label="この申請書を印刷" />
      </div>

      {/* ===== 帳票本体 ===== */}
      <div className="bg-white p-[12mm] text-[11px] leading-snug text-[#000] print:p-0">
        <div className="mb-1 text-right text-[10px]">{formatDate(r.formDate ?? r.createdAt?.slice(0, 10) ?? null)}</div>
        <h1 className="mb-4 text-center text-[15px] font-bold">
          高齢者雇用・アルバイト契約満了に伴う継続雇用申請書
        </h1>

        {/* 対象者情報 */}
        <SectionTitle>対象者情報</SectionTitle>
        <table className="mb-4 w-full border-collapse">
          <tbody>
            <FormRow label="氏名" value={r.employeeName} />
            <FormRow label="所属" value={r.orgUnitName ?? ""} />
            <FormRow label="現在の雇用形態" value={r.currentEmploymentType ?? ""} />
            <FormRow label="契約満了日" value={jpDate(r.contractEndDate)} />
            <FormRow label="年齢" value={age === null ? "" : `${age}歳`} />
          </tbody>
        </table>

        {/* 申請内容 */}
        <SectionTitle>申請内容</SectionTitle>
        <p className="mb-1">{REEMPLOYMENT_FIXED_TEXT.lead}</p>
        <table className="mb-4 w-full border-collapse">
          <tbody>
            <FormRow
              label="雇用形態"
              value={
                <span>
                  {REEMPLOYMENT_TYPES.map((t, i) => (
                    <span key={t}>
                      {i > 0 && <span className="mx-3">・</span>}
                      <span className={r.employmentType === t ? "font-bold underline" : ""}>{t}</span>
                    </span>
                  ))}
                </span>
              }
            />
            <FormRow
              label="契約期間"
              value={
                r.periodFrom || r.periodTo
                  ? `${jpDate(r.periodFrom)} ～ ${jpDate(r.periodTo)}${years ? `（${years}年間）` : ""}`
                  : ""
              }
            />
            <FormRow label="勤務地" value={r.workPlace ?? ""} />
            <FormRow label="勤務日数" value={r.daysPerWeek === null ? "" : `週${r.daysPerWeek}日`} />
            <FormRow
              label="勤務時間"
              value={
                r.workStart && r.workEnd
                  ? `${r.workStart}～${r.workEnd}（休憩${r.breakHours ?? 0}時間・実働${actual ?? ""}時間）`
                  : ""
              }
            />
            <tr>
              <th className="w-[30mm] border border-[#333] bg-[#f2f2f2] px-2 py-1 text-left align-top font-normal">
                業務内容
              </th>
              <td className="border border-[#333] px-2 py-1">
                {r.duties.map((d, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {["①", "②", "③"][i]} {d}
                  </div>
                ))}
              </td>
            </tr>
          </tbody>
        </table>

        {/* 継続雇用の理由・必要性 */}
        <SectionTitle>継続雇用の理由・必要性</SectionTitle>
        <div className="mb-4 space-y-2">
          {REEMPLOYMENT_REASON_HEADINGS.map((heading, i) => (
            <div key={heading}>
              <p className="font-medium">
                {["①", "②", "③", "④"][i]} {heading}
              </p>
              <p className="min-h-[8mm] whitespace-pre-wrap pl-4">{r.reasons[i] ?? ""}</p>
            </div>
          ))}
        </div>

        {/* コンプライアンス確認 */}
        <SectionTitle>コンプライアンス確認</SectionTitle>
        <p className="mb-4">{r.compliance ?? REEMPLOYMENT_FIXED_TEXT.compliance}</p>

        {/* 結論 */}
        <SectionTitle>結論</SectionTitle>
        <p>{REEMPLOYMENT_FIXED_TEXT.conclusion1}</p>
        <p className="mb-4">{r.conclusion ?? REEMPLOYMENT_FIXED_TEXT.conclusion2}</p>

        {/* 承認欄 */}
        <SectionTitle>承認欄</SectionTitle>
        <div className="mb-4 flex">
          {approvals.map((a) => (
            <div key={a.id} className="flex-1 border border-[#333]">
              <div className="border-b border-[#333] bg-[#f2f2f2] px-1 py-[1px] text-center text-[9px]">
                {a.label}
              </div>
              <div className="flex h-[18mm] flex-col items-center justify-center">
                {a.decision === "approved" && (
                  <>
                    <span className="inline-flex h-[11mm] w-[11mm] items-center justify-center rounded-full border border-[#c0392b] text-[8px] leading-tight text-[#c0392b]">
                      {a.approverName?.slice(0, 3) ?? "承認"}
                    </span>
                    <span className="text-[7px] text-[#555]">
                      {a.decidedAt ? formatDate(a.decidedAt.slice(0, 10)) : ""}
                    </span>
                  </>
                )}
                {a.decision === "rejected" && <span className="text-[8px] text-[#c0392b]">差戻</span>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[9px]">
          帳票番号 J-456
          <span className="ml-4 text-[#777]">
            書類番号 {r.docNo} / 起案 {r.draftedName ?? "—"}
          </span>
        </p>
      </div>

      {/* 用紙サイズはこの印刷ルート内で指定する（1ジョブに1つの @page だけ効かせる） */}
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm; } }`}</style>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 border-l-4 border-[#333] pl-2 text-[12px] font-bold">{children}</h2>;
}

function FormRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <th className="w-[30mm] border border-[#333] bg-[#f2f2f2] px-2 py-1 text-left font-normal">
        {label}
      </th>
      <td className="border border-[#333] px-2 py-1">{value}</td>
    </tr>
  );
}

/** 「2026年3月10日」形式。空なら空欄のまま（手書きで書き足せるように）。 */
function jpDate(v: string | null): string {
  if (!v) return "";
  const [y, m, d] = v.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

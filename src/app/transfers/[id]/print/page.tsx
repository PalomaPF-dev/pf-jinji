import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getTransfer, listApprovals } from "@/lib/transfers";
import { getEmployee } from "@/lib/employees";
import { formatDate } from "@/lib/format";
import {
  TRANSFER_COMPARISON_ROWS,
  TRANSFER_FORM,
  TRANSFER_HEADER_FIELDS,
} from "@/lib/transferForm";
import PrintButton from "@/components/PrintButton";
import { TRANSFER_KIND_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 異動申請書の帳票（A4縦）。
 *
 * ★ 指定フォーム（Excel/PDF）の実物を受領したら、差し替えるのはこのページの
 *   レイアウトと src/lib/transferForm.ts の項目定義だけで済むようにしてある。
 *   入力欄・DB・一覧はこれらを参照しているので、ここを実物に合わせれば
 *   「指定フォームに入力した内容が帳票に反映される」状態になる。
 *
 * 現状は一般的な異動申請書の体裁による暫定版。
 */
export default async function TransferPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const t = await getTransfer(id);
  if (!t) notFound();
  const [approvals, employee] = await Promise.all([listApprovals(id), getEmployee(t.employeeId)]);

  return (
    <div className="mx-auto max-w-[210mm] px-4 py-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link
          href={`/transfers/${t.id}`}
          className="inline-flex items-center gap-1 text-sm text-[#707070] hover:text-[#333333]"
        >
          <ArrowLeft className="h-4 w-4" />
          申請書へ戻る
        </Link>
        <PrintButton label="この申請書を印刷" />
      </div>

      {/* ===== 帳票本体 ===== */}
      <div className="bg-white p-[12mm] text-[#000] print:p-0">
        <div className="mb-6 flex items-start justify-between">
          <span className="text-[10px] text-[#555]">{TRANSFER_FORM.formNo}</span>
          <h1 className="text-center text-xl font-bold tracking-[0.4em]">{TRANSFER_FORM.title}</h1>
          <span className="w-16 text-right text-[10px] text-[#555]">
            {formatDate(t.createdAt?.slice(0, 10) ?? null)}
          </span>
        </div>

        {/* 管理情報 */}
        <table className="mb-5 w-full border-collapse text-[11px]">
          <tbody>
            <tr>
              {TRANSFER_HEADER_FIELDS.map((f) => (
                <th
                  key={f.label}
                  className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left font-medium"
                >
                  {f.label}
                </th>
              ))}
            </tr>
            <tr>
              {TRANSFER_HEADER_FIELDS.map((f) => (
                <td key={f.label} className="border border-[#333] px-2 py-2">
                  {f.value(t)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* 対象者 */}
        <table className="mb-5 w-full border-collapse text-[11px]">
          <tbody>
            <tr>
              <th className="w-24 border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left font-medium">
                社員番号
              </th>
              <td className="border border-[#333] px-2 py-2">{t.employeeNo}</td>
              <th className="w-24 border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left font-medium">
                氏名
              </th>
              <td className="border border-[#333] px-2 py-2 text-[13px] font-medium">{t.employeeName}</td>
            </tr>
            <tr>
              <th className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left font-medium">生年月日</th>
              <td className="border border-[#333] px-2 py-2">{formatDate(employee?.birthDate)}</td>
              <th className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left font-medium">入社日</th>
              <td className="border border-[#333] px-2 py-2">{formatDate(employee?.hireDate)}</td>
            </tr>
          </tbody>
        </table>

        {/* 異動前 → 異動後 */}
        <table className="mb-5 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="w-24 border border-[#333] bg-[#f2f2f2] px-2 py-1.5 font-medium"> </th>
              <th className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 font-medium">異 動 前</th>
              <th className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 font-medium">異 動 後</th>
            </tr>
          </thead>
          <tbody>
            {TRANSFER_COMPARISON_ROWS.map((r) => (
              <tr key={r.label}>
                <th className="border border-[#333] bg-[#f2f2f2] px-2 py-2 text-left font-medium">
                  {r.label}
                </th>
                <td className="border border-[#333] px-2 py-2">{r.before(t)}</td>
                <td className="border border-[#333] px-2 py-2 font-medium">{r.after(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 理由・備考 */}
        <table className="mb-6 w-full border-collapse text-[11px]">
          <tbody>
            <tr>
              <th className="w-24 border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left align-top font-medium">
                異動理由
              </th>
              <td className="h-20 border border-[#333] px-2 py-2 align-top whitespace-pre-wrap">
                {t.reason ?? ""}
              </td>
            </tr>
            <tr>
              <th className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 text-left align-top font-medium">
                備考
              </th>
              <td className="h-14 border border-[#333] px-2 py-2 align-top whitespace-pre-wrap">
                {t.remarks ?? ""}
              </td>
            </tr>
          </tbody>
        </table>

        {/* 承認欄（捺印枠） */}
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {approvals.map((a) => (
                <th key={a.id} className="border border-[#333] bg-[#f2f2f2] px-2 py-1.5 font-medium">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {approvals.map((a) => (
                <td key={a.id} className="h-20 border border-[#333] px-2 py-2 text-center align-middle">
                  {a.decision === "approved" ? (
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#c0392b] text-[10px] leading-tight text-[#c0392b]">
                      {a.approverName?.slice(0, 3) ?? "承認"}
                    </span>
                  ) : a.decision === "rejected" ? (
                    <span className="text-[10px] text-[#c0392b]">差戻</span>
                  ) : (
                    <span className="text-[10px] text-[#999]"> </span>
                  )}
                  <div className="mt-1 text-[9px] text-[#555]">
                    {a.decidedAt ? formatDate(a.decidedAt.slice(0, 10)) : ""}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-[9px] text-[#777]">
          {TRANSFER_KIND_LABEL[t.kind]} / {t.transferNo} / 起案: {t.draftedName ?? "—"}
        </p>
      </div>

      {/* 用紙サイズはこの印刷ルート内で指定する（1ジョブに1つの @page だけ効かせる） */}
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm; } }`}</style>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Printer } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getTransfer, listApprovals } from "@/lib/transfers";
import { formatDate, formatDateTime } from "@/lib/format";
import { TRANSFER_COMPARISON_ROWS } from "@/lib/transferForm";
import { TransferStatusBadge } from "@/components/Badges";
import PageHeader from "@/components/PageHeader";
import {
  ApplyTransferForm,
  ApprovalPanel,
  SubmitTransferForm,
} from "@/components/TransferWorkflow";
import { TRANSFER_KIND_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-[#f0f0f0] py-2.5 last:border-0">
      <dt className="w-20 shrink-0 text-xs text-[#909090]">{label}</dt>
      <dd className="text-sm text-[#333333]">{value}</dd>
    </div>
  );
}

/** 異動申請の詳細。状態に応じて申請・承認・発令の導線を出す。 */
export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const t = await getTransfer(id);
  if (!t) notFound();
  const approvals = await listApprovals(id);
  const editable = t.status === "draft" || t.status === "rejected";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title={t.transferNo}
        description={`${t.employeeName}（${t.employeeNo}） / ${TRANSFER_KIND_LABEL[t.kind]}`}
        backHref="/transfers"
        backLabel="一覧へ戻る"
        actions={
          <>
            <Link
              href={`/transfers/${t.id}/print`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Printer className="h-4 w-4" />
              申請書を印刷
            </Link>
            {editable && (
              <Link
                href={`/transfers/${t.id}/edit`}
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
        <TransferStatusBadge status={t.status} />
        {t.status === "issued" && t.appliedAt && (
          <span className="text-xs text-[#707070]">{formatDateTime(t.appliedAt)} に人事マスターへ反映済み</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && <SubmitTransferForm id={t.id} />}
          {t.status === "approved" && <ApplyTransferForm transfer={t} />}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">申請の内容</h2>
          <dl>
            <Row label="対象者" value={<Link href={`/employees/${t.employeeId}`} className="text-[#2563eb] hover:underline">{t.employeeName}</Link>} />
            <Row label="異動区分" value={TRANSFER_KIND_LABEL[t.kind]} />
            <Row label="発令日" value={formatDate(t.orderDate)} />
            <Row label="適用日" value={formatDate(t.effectiveDate)} />
            <Row label="起案者" value={t.draftedName ?? "—"} />
          </dl>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">異動前 → 異動後</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#909090]">
                <th className="pb-2 font-medium"> </th>
                <th className="pb-2 font-medium">現</th>
                <th className="pb-2 font-medium">新</th>
              </tr>
            </thead>
            <tbody>
              {TRANSFER_COMPARISON_ROWS.map((r) => (
                <tr key={r.label} className="border-t border-[#f0f0f0]">
                  <td className="py-2 text-xs text-[#909090]">{r.label}</td>
                  <td className="py-2 text-[#707070]">{r.before(t)}</td>
                  <td className="py-2 font-medium text-[#333333]">{r.after(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5 md:col-span-2">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">理由・備考</h2>
          <dl>
            <Row
              label="異動理由"
              value={t.reason ? <span className="whitespace-pre-wrap">{t.reason}</span> : "—"}
            />
            <Row
              label="備考"
              value={t.remarks ? <span className="whitespace-pre-wrap">{t.remarks}</span> : "—"}
            />
          </dl>
        </section>

        <div className="md:col-span-2">
          <ApprovalPanel transfer={t} approvals={approvals} />
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { getTransfer, listApprovals } from "@/lib/transfers";
import { APPENDIX_HEADERS, buildAppendixRows, type AppendixRow } from "@/lib/transferAppendix";
import { formatDate } from "@/lib/format";
import { TRANSFER_COMPARISON_ROWS, TRANSFER_FORM, TRANSFER_SUBJECT_FIELDS } from "@/lib/transferForm";
import PrintButton from "@/components/PrintButton";
import {
  ASSIGNMENT_KINDS,
  COMPANY_CAR_AFTER_KINDS,
  DEPT_AGREEMENTS,
  HOUSING_KINDS,
  MOBILE_AFTER_KINDS,
  PARKING_KINDS,
  SINGLE_ASSIGNMENT_REASONS,
  TRANSFER_HR_PROCESS_BOXES,
  TRANSFER_ROUTING_BOXES,
  YES_NO,
  type TransferApproval,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 指定帳票 **J-426(9)「異動申請書 ・ 組織名称追加変更申請書」** の印刷ページ（A4縦）。
 *
 * 実物のExcelの並び・文言をそのまま再現している。用紙に手書きでㇾ点を入れる
 * 運用も残せるよう、未選択のチェック欄は空の□として印刷する。
 *
 * 項目定義は src/lib/transferForm.ts、選択肢は src/lib/types.ts に置いてある。
 */
export default async function TransferPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireJinjiSession();
  const { id } = await params;
  const t = await getTransfer(id);
  if (!t) notFound();
  const [approvals, appendix] = await Promise.all([
    listApprovals(id),
    t.isBulk ? buildAppendixRows(id) : Promise.resolve([] as AppendixRow[]),
  ]);

  // 一括申請は【対象社員】【異動部署】に「別紙参照」と載せ、一覧は別紙として刷る
  const subjectRows = t.isBulk
    ? [
        { label: "部　　　署", value: "別紙参照" },
        { label: "社員ｺｰﾄﾞ", value: "" },
        { label: "氏　　　名", value: `別紙参照（${appendix.length}名）` },
      ]
    : TRANSFER_SUBJECT_FIELDS.map((f) => ({ label: f.label, value: f.value(t) }));
  const comparisonRows = t.isBulk
    ? [
        { label: "部署：", before: "別紙参照", after: "別紙参照" },
        { label: "職務：", before: "", after: "" },
      ]
    : TRANSFER_COMPARISON_ROWS.map((r) => ({
        label: r.label,
        before: r.before(t),
        after: r.after(t),
      }));

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
      <div className="bg-white p-[10mm] text-[10px] leading-tight text-[#000] print:p-0">
        {/* 右上：西暦 年 月 日 作成 */}
        <div className="mb-1 flex justify-end">
          <JpDate label="西暦" value={t.formDate ?? t.createdAt?.slice(0, 10) ?? null} suffix="作成" />
        </div>

        <h1 className="mb-1 text-center text-[15px] font-bold">{TRANSFER_FORM.title}</h1>
        <p className="mb-3">{TRANSFER_FORM.lead}</p>

        {/* 【対象社員】 */}
        <Block label="【対象社員】">
          <table className="w-full border-collapse">
            <tbody>
              {subjectRows.map((f) => (
                <tr key={f.label}>
                  <th className="w-[22mm] border border-[#333] bg-[#f2f2f2] px-1 py-[3px] text-left font-normal">
                    {f.label}
                  </th>
                  <td className="border border-[#333] px-1 py-[3px]">{f.value || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        {/* 【異動日付】 */}
        <Block label="【異動日付】">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <JpDate value={t.effectiveDate} />
            <span className="flex items-center gap-2">
              <span>異動先赴任日</span>
              <JpDate value={t.arrivalDate} />
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="whitespace-pre-line text-[9px]">{"※期間限定\nの場合"}</span>
            <JpDate value={t.limitedFrom} />
            <span>～</span>
            <JpDate value={t.limitedTo} />
          </div>
        </Block>

        {/* 【異動部署】 */}
        <Block label="【異動部署】">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-1/2 border border-[#333] bg-[#f2f2f2] px-1 py-[3px] font-normal">
                  現所属部署
                </th>
                <th className="w-1/2 border border-[#333] bg-[#f2f2f2] px-1 py-[3px] font-normal">
                  異動先部署
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((r) => (
                <tr key={r.label}>
                  <td className="border border-[#333] px-1 py-[3px]">
                    <span className="text-[#555]">{r.label}</span> {r.before}
                  </td>
                  <td className="border border-[#333] px-1 py-[3px]">
                    <span className="text-[#555]">{r.label}</span> {r.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-[2px] text-[9px]">{TRANSFER_FORM.dutyNote}</p>
        </Block>

        {/* 【異動事由】 */}
        <Block label="【異動事由】">
          <div className="h-[16mm] whitespace-pre-wrap border border-[#333] px-1 py-[3px]">
            {t.reason ?? ""}
          </div>
        </Block>

        {/* 【部門長間の合意】 */}
        <div className="mb-2 flex items-center gap-3">
          <span className="font-medium">【部門長間の合意】</span>
          <span className="text-[9px]">{TRANSFER_FORM.deptAgreementNote}</span>
          <Checks options={DEPT_AGREEMENTS} value={t.deptAgreement} />
        </div>

        {/* 【組織名称】 */}
        <div className="mb-2 flex items-center gap-3">
          <span className="font-medium">【組織名称】</span>
          <span className="flex items-center gap-1">
            変更前
            <span className="inline-block min-w-[45mm] border-b border-[#333] px-1">
              {t.orgNameBefore ?? ""}
            </span>
          </span>
          <span className="flex items-center gap-1">
            追加・変更後
            <span className="inline-block min-w-[45mm] border-b border-[#333] px-1">
              {t.orgNameAfter ?? ""}
            </span>
          </span>
        </div>

        {/* ===== 該当にㇾ点 ===== */}
        <p className="mb-1 font-medium">{TRANSFER_FORM.checkNote}</p>
        <div className="mb-2 grid grid-cols-2 gap-x-4 border border-[#333] p-2">
          {/* 左半分：転居まわり */}
          <div className="space-y-1 border-r border-dashed border-[#bbb] pr-3">
            <div className="flex items-center gap-3">
              <span className="font-medium">【転居】</span>
              <Checks options={YES_NO} value={t.relocation} />
            </div>
            <div className="flex gap-2">
              <CheckColumn title="【異動前 住居】" options={HOUSING_KINDS} value={t.housingBefore} />
              <span className="self-center">→</span>
              <CheckColumn title="【異動後 住居】" options={HOUSING_KINDS} value={t.housingAfter} />
            </div>
            <div className="flex gap-2 pt-1">
              <CheckColumn title="【異動前 赴任形態】" options={ASSIGNMENT_KINDS} value={t.assignmentBefore} />
              <span className="self-center">→</span>
              <CheckColumn title="【異動後 赴任形態】" options={ASSIGNMENT_KINDS} value={t.assignmentAfter} />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <span className="font-medium">【通勤経路変更】</span>
              <Checks options={YES_NO} value={t.commuteChange} />
            </div>
          </div>

          {/* 右半分：携帯・社用車・単身赴任事由 */}
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="font-medium">【携帯】</span>
              <Checks options={YES_NO} value={t.mobile} />
            </div>
            <CheckColumn title="【異動後】" options={MOBILE_AFTER_KINDS} value={t.mobileAfter} />
            <div className="flex items-center gap-3 pt-1">
              <span className="font-medium">【社用車】</span>
              <Checks options={YES_NO} value={t.companyCar} />
            </div>
            <div className="flex flex-wrap gap-x-4">
              {COMPANY_CAR_AFTER_KINDS.map((o) => (
                <Check key={o} on={t.companyCarAfter === o}>
                  {o}
                  {o === "その他" && (
                    <span className="ml-1">（{t.companyCarAfter === "その他" ? t.companyCarOther ?? "" : ""}）</span>
                  )}
                </Check>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <span className="font-medium">【社用車駐車場】</span>
              <Checks options={PARKING_KINDS} value={t.parking} />
            </div>
            <div className="pt-1">
              <p className="font-medium">&lt;単身赴任 事由&gt;（複数チェック可）</p>
              {SINGLE_ASSIGNMENT_REASONS.map((label, i) => (
                <Check key={i} on={t.singleReasons.includes(i)}>
                  {["①", "②", "③", "④"][i]} {label}
                </Check>
              ))}
            </div>
          </div>
        </div>

        {/* 【本人への説明・合意】【後任の確認】 */}
        <div className="mb-2 space-y-[2px]">
          <div className="flex items-start gap-2">
            <span className="w-[32mm] shrink-0 font-medium">【本人への説明・合意】</span>
            <span className="flex-1">
              上長は異動者本人へ職務分掌・権限規程(KS-0010)に記載された、職務の内容を伝え、本人の合意を得たか。
            </span>
            <Check on={t.explainedAgreed}>説明を行い、合意を得た</Check>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-[32mm] shrink-0 font-medium">【後任の確認】</span>
            <span className="flex-1">異動にあたり、後任が必要かを確認した。</span>
            <Check on={t.successorChecked}>確認済</Check>
          </div>
        </div>

        {/* ===== 決裁欄 ===== */}
        <div className="mb-2 flex gap-4">
          {/* 左：決裁後に回付される押印枠（アプリでは記録しない） */}
          <StampGrid title="" boxes={TRANSFER_ROUTING_BOXES.map((label) => ({ label }))} />
          {/* 右：承認（このアプリの決裁ルート）。帳票に合わせて右から 役員・部門長・申請者 */}
          <StampGrid
            title="承認"
            boxes={[...approvals].reverse().map((a) => ({ label: a.label, approval: a }))}
          />
        </div>

        {/* 注意書き */}
        <div className="mb-2 space-y-[1px] text-[9px]">
          {TRANSFER_FORM.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>

        {/* 情報ｼｽﾃﾑ部記入欄 */}
        <div className="mb-2 flex items-center gap-2 border border-[#333] px-1 py-[3px]">
          <span className="font-medium">情報ｼｽﾃﾑ部記入欄</span>
          <span>部門コード（8桁）</span>
          <span className="inline-block min-w-[28mm] border-b border-[#333] px-1">
            {t.systemDeptCode ?? ""}
          </span>
          <span>名称</span>
          <span className="inline-block min-w-[45mm] border-b border-[#333] px-1">
            {t.systemDeptName ?? ""}
          </span>
        </div>

        {/* 【総務人事部使用欄】 */}
        <div className="border border-[#333] px-1 py-[3px]">
          <span className="font-medium">【総務人事部使用欄】</span>
          <div className="mt-[2px] flex items-end gap-1">
            {TRANSFER_HR_PROCESS_BOXES.map((b, i) => (
              <span key={b.label} className="flex items-end gap-1">
                <span className="text-center">
                  <span className="block">{b.label}</span>
                  <span className="block text-[8px]">{b.note}</span>
                  <span className="mt-[2px] block h-[9mm] w-[18mm] border border-[#333]" />
                </span>
                {i < TRANSFER_HR_PROCESS_BOXES.length - 1 && <span className="pb-[10mm]">→</span>}
              </span>
            ))}
          </div>
        </div>

        <p className="mt-2 text-[9px]">
          {TRANSFER_FORM.formNo}
          <span className="ml-4 text-[#777]">
            申請番号 {t.transferNo} / 起案 {t.draftedName ?? "—"}
          </span>
        </p>
      </div>

      {/* ===== 別紙（異動者一覧）。一括申請のみ、改ページして刷る ===== */}
      {t.isBulk && (
        <div
          className="bg-white p-[10mm] text-[9px] leading-tight text-[#000] print:p-0"
          style={{ breakBefore: "page" }}
        >
          <h2 className="mb-2 text-center text-[13px] font-bold">
            異動申請書 別紙（異動者一覧） {appendix.length}名
          </h2>
          <p className="mb-1 text-[#555]">申請番号 {t.transferNo}</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {APPENDIX_HEADERS.map((h) => (
                  <th key={h} className="border border-[#333] bg-[#f2f2f2] px-1 py-[2px] text-left font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appendix.map((r, i) => (
                <tr key={i}>
                  <td className="border border-[#333] px-1 py-[2px]">{r.factory}</td>
                  <td className="border border-[#333] px-1 py-[2px] whitespace-nowrap">{r.effectiveDate}</td>
                  <td className="border border-[#333] px-1 py-[2px] font-mono">{r.employeeNo}</td>
                  <td className="border border-[#333] px-1 py-[2px] whitespace-nowrap">{r.employeeName}</td>
                  <td className="border border-[#333] px-1 py-[2px] font-mono">{r.fromCode}</td>
                  <td className="border border-[#333] px-1 py-[2px]">{r.fromPath}</td>
                  <td className="border border-[#333] px-1 py-[2px] font-mono">{r.toCode}</td>
                  <td className="border border-[#333] px-1 py-[2px]">{r.toName}</td>
                  <td className="border border-[#333] px-1 py-[2px]">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 用紙サイズはこの印刷ルート内で指定する（1ジョブに1つの @page だけ効かせる） */}
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } }`}</style>
    </div>
  );
}

/** 見出し付きのブロック（帳票の【…】欄）。 */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex gap-2">
      <span className="w-[22mm] shrink-0 pt-[2px] font-medium">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/**
 * 「西暦　年　月　日」の枠。値があれば埋め、無ければ空欄のまま印刷する
 * （手書きで書き足せるようにするため）。
 */
function JpDate({ label, value, suffix }: { label?: string; value: string | null; suffix?: string }) {
  const [y, m, d] = value ? value.split("-") : ["", "", ""];
  const cell = "inline-block min-w-[10mm] border-b border-[#333] px-1 text-center";
  return (
    <span className="inline-flex items-center gap-1">
      {label && <span>{label}</span>}
      <span className={cell}>{y}</span>年
      <span className={cell}>{m}</span>月
      <span className={cell}>{d}</span>日
      {suffix && <span className="ml-1">{suffix}</span>}
    </span>
  );
}

/** □ ひとつ。on なら ☑ にする。 */
function Check({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1 whitespace-nowrap">
      <span className="mt-[1px] inline-block h-[3mm] w-[3mm] shrink-0 border border-[#333] text-center text-[8px] leading-[3mm]">
        {on ? "✓" : ""}
      </span>
      <span className="whitespace-normal">{children}</span>
    </span>
  );
}

/** 選択肢を横に並べたチェック欄。 */
function Checks({ options, value }: { options: readonly string[]; value: string | null }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      {options.map((o) => (
        <Check key={o} on={value === o}>
          {o}
        </Check>
      ))}
    </span>
  );
}

/** 見出し付きで縦に並べたチェック欄（住居・赴任形態など）。 */
function CheckColumn({
  title,
  options,
  value,
}: {
  title: string;
  options: readonly string[];
  value: string | null;
}) {
  return (
    <div className="flex-1">
      <p className="font-medium">{title}</p>
      {options.map((o) => (
        <Check key={o} on={value === o}>
          {o}
        </Check>
      ))}
    </div>
  );
}

/**
 * 押印枠。承認済みなら氏名と日付を入れ、それ以外は空欄で印刷する。
 * approval を渡さない枠（回付先）は常に空欄。
 */
function StampGrid({
  title,
  boxes,
}: {
  title: string;
  boxes: { label: string; approval?: TransferApproval }[];
}) {
  return (
    <div className="flex-1">
      {title && <p className="text-center font-medium">{title}</p>}
      <div className="flex">
        {boxes.map((b) => (
          <div key={b.label} className="flex-1 border border-[#333]">
            <div className="border-b border-[#333] bg-[#f2f2f2] px-1 py-[1px] text-center text-[9px]">
              {b.label}
            </div>
            <div className="flex h-[13mm] flex-col items-center justify-center">
              {b.approval?.decision === "approved" && (
                <>
                  <span className="inline-flex h-[9mm] w-[9mm] items-center justify-center rounded-full border border-[#c0392b] text-[8px] leading-tight text-[#c0392b]">
                    {b.approval.approverName?.slice(0, 3) ?? "承認"}
                  </span>
                  <span className="text-[7px] text-[#555]">
                    {b.approval.decidedAt ? formatDate(b.approval.decidedAt.slice(0, 10)) : ""}
                  </span>
                </>
              )}
              {b.approval?.decision === "rejected" && (
                <span className="text-[8px] text-[#c0392b]">差戻</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { requireJinjiSession } from "@/lib/session";
import { EMPLOYEE_CSV_HEADERS } from "@/lib/employees";
import PageHeader from "@/components/PageHeader";
import EmployeeImportForm from "@/components/EmployeeImportForm";

export const dynamic = "force-dynamic";

export default async function EmployeeImportPage() {
  await requireJinjiSession();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="社員台帳のCSV取込"
        description="ポータルのアカウント連携が未整備でも、この経路だけで台帳を作れます。"
        backHref="/employees"
        backLabel="社員台帳へ戻る"
      />

      <div className="mb-5 rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-2 text-sm font-bold text-[#333333]">列の並び</h2>
        <p className="mb-3 text-xs text-[#707070]">
          1行目をヘッダ行にしてください。列の順番は自由で、必要な列だけあれば動きます
          （必須は「社員番号」「氏名」）。
        </p>
        <div className="overflow-x-auto">
          <code className="whitespace-nowrap rounded bg-[#f7f7f5] px-2 py-1 text-xs text-[#555555]">
            {EMPLOYEE_CSV_HEADERS.join(",")}
          </code>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-[#909090]">
          <li>・日付は 2026-04-01 / 2026/4/1 / 20260401 のいずれでも読み取ります。</li>
          <li>・「所属コード」は組織図で設定した組織コードです。存在しないコードの行はエラーになります。</li>
          <li>・「性別」は 男性／女性／その他、「在籍状態」は 在籍／休職／出向／退職 で入力します。</li>
        </ul>
      </div>

      <EmployeeImportForm />
    </div>
  );
}

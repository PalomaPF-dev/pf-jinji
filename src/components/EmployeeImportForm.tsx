"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import { importEmployeesAction, type ActionState } from "@/app/employees/actions";

/**
 * 社員台帳の取込。Excel(.xlsx) と CSV の両方を受ける。
 * 行ごとのエラーは結果表に出し、通った行はそのまま反映する。
 */
export default function EmployeeImportForm() {
  const [state, formAction] = useActionState(importEmployeesAction, {} as ActionState);
  const result = state.importResult;

  return (
    <>
      <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <label htmlFor="file" className="mb-1 block text-sm font-medium text-[#555555]">
          ファイル（Excel または CSV）
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.csv,text/csv"
          required
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f0f0f0] file:px-3 file:py-1.5 file:text-xs"
        />
        <p className="mt-2 text-xs text-[#909090]">
          社員番号をキーに、既にある人は更新・無い人は新規登録します（最大15MB）。
          人事システムの名簿は<strong>Excelのまま</strong>入れてください（CSVに変換すると社員番号の先頭ゼロが落ちます）。
          社員番号と生年月日・入社年月日が載ったファイル（権限マスタ等）を入れると、
          既存の社員に<strong>生年月日・入社日だけ</strong>を補完します（社員の新規登録や所属の変更はしません）。
          「階層」「承認者」の2シートを持つ<strong>人事マスタ</strong>を入れると、
          組織図の階層と、社員の所属・管理者（承認者）を作り直します（N/A の箇所は既存の値を残します）。
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sheet" className="mb-1 block text-sm font-medium text-[#555555]">
              シート名（任意）
            </label>
            <input
              id="sheet"
              name="sheet"
              placeholder="未入力なら先頭のシート"
              className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
            <p className="mt-1 text-xs text-[#909090]">Excelに複数シートがある場合に指定します。</p>
          </div>
          <div>
            <label htmlFor="parentOrgNames" className="mb-1 block text-sm font-medium text-[#555555]">
              取り込む上位組織（任意・改行区切り）
            </label>
            <textarea
              id="parentOrgNames"
              name="parentOrgNames"
              rows={2}
              placeholder={"生産・調達統括本部\nパロマ精工"}
              className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
            <p className="mt-1 text-xs text-[#909090]">
              名簿の「組織名称漢字２」で絞ります。全社名簿から本部ぶんだけ取り込むときに使います。
            </p>
          </div>
        </div>
        <div className="mt-4">
          <SubmitButton>取り込む</SubmitButton>
        </div>

        {state.error && (
          <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
        )}
        {state.message && (
          <p className="mt-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
        )}
      </form>

      {result && result.errors.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-[#f0d9d9] bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fdf6f6] text-left text-xs text-[#b91c1c]">
                <th className="px-4 py-2 font-medium">行</th>
                <th className="px-4 py-2 font-medium">社員番号</th>
                <th className="px-4 py-2 font-medium">取り込めなかった理由</th>
              </tr>
            </thead>
            <tbody>
              {result.errors.map((e, i) => (
                <tr key={i} className="border-b border-[#f0f0f0] last:border-0">
                  <td className="px-4 py-2 text-[#707070]">{e.row}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[#707070]">{e.employeeNo || "—"}</td>
                  <td className="px-4 py-2 text-[#555555]">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

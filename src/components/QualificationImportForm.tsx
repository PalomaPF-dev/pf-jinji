"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import { importQualificationsAction, type QualificationImportState } from "@/app/qualifications/actions";

/**
 * 資格取得状況（人事システムのExcel）の取込。
 * 取り込み直しは「置き換え」になるので、そのことを画面に書いておく。
 */
export default function QualificationImportForm() {
  const [state, formAction] = useActionState(
    importQualificationsAction,
    {} as QualificationImportState,
  );
  const r = state.result;

  return (
    <>
      <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-3 text-base font-medium text-[#333333]">資格取得状況の取込</h2>
        <label htmlFor="qfile" className="mb-1 block text-sm font-medium text-[#555555]">
          ファイル（Excel）
        </label>
        <input
          id="qfile"
          name="file"
          type="file"
          accept=".xlsx"
          required
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f0f0f0] file:px-3 file:py-1.5 file:text-xs"
        />
        <p className="mt-2 text-xs text-[#909090]">
          人事システムの「全社員明細」と「区分マスター」の2シートを持つExcelを、
          <strong>Excelのまま</strong>入れてください（最大15MB）。
          資格コードから資格マスターを作り、社員番号で社員台帳と突き合わせて保有資格を登録します。
          <strong>取り込むたびに前回の取込ぶんを入れ替えます</strong>
          （この画面から手で登録した資格は消えません）。社員台帳に居ない社員番号は取り込みません。
        </p>
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

      {r && r.missing.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#f0e2c8] bg-[#fffaf0] p-4 text-sm text-[#8a6d3b]">
          <p className="font-medium">社員台帳に居ないため取り込まなかった社員番号（{r.missing.length} 名）</p>
          <p className="mt-1 font-mono text-xs leading-6">{r.missing.join("、")}</p>
        </div>
      )}

      {r && r.ungrouped.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <p className="border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2 text-xs text-[#707070]">
            「区分マスター」に載っていない資格（{r.ungrouped.length} 種）。区分は空欄・「その他」で登録しました。
          </p>
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] text-left text-xs text-[#707070]">
                <th className="px-4 py-2 font-medium">コード</th>
                <th className="px-4 py-2 font-medium">資格名</th>
                <th className="px-4 py-2 font-medium">件数</th>
              </tr>
            </thead>
            <tbody>
              {r.ungrouped.map((u) => (
                <tr key={u.code} className="border-b border-[#f0f0f0] last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-[#707070]">{u.code}</td>
                  <td className="px-4 py-2 text-[#333333]">{u.name}</td>
                  <td className="px-4 py-2 text-right text-[#707070]">{u.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r && r.errors.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[#f0d9d9] bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fdf6f6] text-left text-xs text-[#b91c1c]">
                <th className="px-4 py-2 font-medium">行</th>
                <th className="px-4 py-2 font-medium">社員番号</th>
                <th className="px-4 py-2 font-medium">取り込めなかった理由</th>
              </tr>
            </thead>
            <tbody>
              {r.errors.map((e, i) => (
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

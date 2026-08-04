"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import { importEmployeesAction, type ActionState } from "@/app/employees/actions";

/** 社員台帳のCSV取込。行ごとのエラーは結果表に出し、通った行はそのまま反映する。 */
export default function EmployeeImportForm() {
  const [state, formAction] = useActionState(importEmployeesAction, {} as ActionState);
  const result = state.importResult;

  return (
    <>
      <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <label htmlFor="file" className="mb-1 block text-sm font-medium text-[#555555]">
          CSVファイル
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f0f0f0] file:px-3 file:py-1.5 file:text-xs"
        />
        <p className="mt-2 text-xs text-[#909090]">
          社員番号をキーに、既にある人は更新・無い人は新規登録します（最大5MB）。
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

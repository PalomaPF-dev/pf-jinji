"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import { importBonusMasterAction, type BonusImportActionState } from "@/app/salaries/actions";

/**
 * 賞与マスタ（給与・考課のExcel）の取込フォーム。
 * 適用開始年月はシート名（賞与マスタ202607 → 2026-07-01）から自動で決まる。
 */
export default function BonusImportForm({ canEvaluation }: { canEvaluation: boolean }) {
  const [state, formAction] = useActionState(importBonusMasterAction, {} as BonusImportActionState);

  return (
    <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">賞与マスタの取込</h2>
      <p className="mb-4 text-xs text-[#707070]">
        人事システムの賞与マスタ（Excel）から、基本給・手当を給与履歴として取り込みます。
        {canEvaluation
          ? "考課の列（中間・最終）は確定済みの人事考課として登録します（既にある期は上書きしません）。"
          : "考課の列は、考課の権限が無いため取り込みません。"}
      </p>
      <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="bfile" className="mb-1 block text-xs font-medium text-[#707070]">
            Excelファイル
          </label>
          <input
            id="bfile"
            name="file"
            type="file"
            accept=".xlsx"
            required
            className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f0f0f0] file:px-3 file:py-1.5 file:text-xs"
          />
        </div>
        <div>
          <label htmlFor="beff" className="mb-1 block text-xs font-medium text-[#707070]">
            適用開始年月（任意）
          </label>
          <input
            id="beff"
            name="effectiveFrom"
            type="date"
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <SubmitButton>取り込む</SubmitButton>
      </form>
      <p className="mt-2 text-xs text-[#909090]">
        未指定ならシート名の年月（賞与マスタ202607 → 2026年7月）を適用開始にします。
        社員台帳に居ない社員番号は取り込まず、一覧で表示します。
      </p>

      {state.error && (
        <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}
      {state.missing && state.missing.length > 0 && (
        <div className="mt-3 rounded-lg border border-[#f0e2c8] bg-[#fdfaf3] px-3 py-2 text-xs text-[#a06a12]">
          台帳に居ないため対象外: {state.missing.slice(0, 30).join("、")}
          {state.missing.length > 30 && ` ほか ${state.missing.length - 30} 名`}
        </div>
      )}
      {state.errors && state.errors.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#f0d9d9]">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="bg-[#fdf6f6] text-left text-[#b91c1c]">
                <th className="px-3 py-1.5 font-medium">行</th>
                <th className="px-3 py-1.5 font-medium">社員番号</th>
                <th className="px-3 py-1.5 font-medium">理由</th>
              </tr>
            </thead>
            <tbody>
              {state.errors.map((e, i) => (
                <tr key={i} className="border-t border-[#f0f0f0]">
                  <td className="px-3 py-1.5 text-[#707070]">{e.row || "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{e.employeeNo}</td>
                  <td className="px-3 py-1.5 text-[#555555]">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

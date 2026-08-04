"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import { createSalaryAction, voidSalaryAction, type SalaryActionState } from "@/app/salaries/actions";
import { pick } from "@/lib/formState";
import { SALARY_REVISION_KINDS } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

/** 給与改定の登録フォーム。手当は名称と金額の組を5つまで。 */
export default function SalaryRevisionForm({
  employeeId,
  defaultGrade,
}: {
  employeeId: string;
  defaultGrade: string | null;
}) {
  const [state, action] = useActionState(createSalaryAction, {} as SalaryActionState);
  const v = state.values;

  return (
    <form action={action} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-4 text-sm font-bold text-[#333333]">給与改定の登録</h2>
      <input type="hidden" name="employeeId" value={employeeId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="effectiveFrom" className="mb-1 block text-sm font-medium text-[#555555]">
            適用開始年月 *
          </label>
          <input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={pick(v, "effectiveFrom", null)}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#909090]">月初に丸めて保存します。</p>
        </div>
        <div>
          <label htmlFor="baseSalary" className="mb-1 block text-sm font-medium text-[#555555]">
            基本給（円） *
          </label>
          <input
            id="baseSalary"
            name="baseSalary"
            inputMode="numeric"
            required
            defaultValue={pick(v, "baseSalary", null)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="grade" className="mb-1 block text-sm font-medium text-[#555555]">
            等級
          </label>
          <input id="grade" name="grade" defaultValue={pick(v, "grade", defaultGrade)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="step" className="mb-1 block text-sm font-medium text-[#555555]">
            号俸
          </label>
          <input id="step" name="step" defaultValue={pick(v, "step", null)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="revisionKind" className="mb-1 block text-sm font-medium text-[#555555]">
            改定区分
          </label>
          <select
            id="revisionKind"
            name="revisionKind"
            key={`kind-${v?.revisionKind ?? ""}`}
            defaultValue={v?.revisionKind ?? "新規登録"}
            className={INPUT}
          >
            {SALARY_REVISION_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reason" className="mb-1 block text-sm font-medium text-[#555555]">
            改定理由
          </label>
          <input id="reason" name="reason" defaultValue={pick(v, "reason", null)} className={INPUT} />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-[#555555]">手当（任意・5件まで）</legend>
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="grid grid-cols-[1fr_10rem] gap-2">
              <input
                name={`allowanceName${i}`}
                placeholder="名称（役職手当 等）"
                defaultValue={pick(v, `allowanceName${i}`, null)}
                className={INPUT}
              />
              <input
                name={`allowanceAmount${i}`}
                inputMode="numeric"
                placeholder="金額"
                defaultValue={pick(v, `allowanceAmount${i}`, null)}
                className={INPUT}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}

      <div className="mt-4">
        <SubmitButton>この内容で登録</SubmitButton>
      </div>
    </form>
  );
}

/** 改定の取り消し（無効化）。 */
export function VoidSalaryForm({
  id,
  employeeId,
  label,
}: {
  id: string;
  employeeId: string;
  label: string;
}) {
  const [state, action] = useActionState(voidSalaryAction, {} as SalaryActionState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <SubmitButton
        variant="secondary"
        className="!px-2 !py-1 !text-xs"
        confirm={`${label} の改定を取り消します。よろしいですか？`}
      >
        取り消す
      </SubmitButton>
      {state.error && <p className="mt-1 text-xs text-[#b91c1c]">{state.error}</p>}
    </form>
  );
}

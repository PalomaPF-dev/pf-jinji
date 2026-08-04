"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import {
  createQualificationAction,
  deleteQualificationAction,
  type QualificationActionState,
} from "@/app/qualifications/actions";
import { pick } from "@/lib/formState";
import { QUALIFICATION_CATEGORY_LABEL, type QualificationMaster } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

export interface EmployeeChoice {
  id: string;
  employeeNo: string;
  name: string;
}

/** 保有資格の登録。マスターを選ぶと資格名・区分が自動で入る。 */
export default function QualificationForm({
  employees,
  masters,
  defaultEmployeeId,
}: {
  employees: EmployeeChoice[];
  masters: QualificationMaster[];
  defaultEmployeeId?: string;
}) {
  const [state, action] = useActionState(createQualificationAction, {} as QualificationActionState);
  const v = state.values;

  return (
    <form action={action} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-4 text-sm font-bold text-[#333333]">保有資格の登録</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="employeeId" className="mb-1 block text-sm font-medium text-[#555555]">
            対象者 *
          </label>
          <select
            id="employeeId"
            name="employeeId"
            required
            key={`emp-${v?.employeeId ?? ""}`}
            defaultValue={v?.employeeId ?? defaultEmployeeId ?? ""}
            className={INPUT}
          >
            <option value="">選んでください</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}（{e.employeeNo}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="masterId" className="mb-1 block text-sm font-medium text-[#555555]">
            資格マスター
          </label>
          <select
            id="masterId"
            name="masterId"
            key={`master-${v?.masterId ?? ""}`}
            defaultValue={v?.masterId ?? ""}
            className={INPUT}
          >
            <option value="">（マスターを使わず自由入力）</option>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.renewalRequired && m.renewalMonths ? `（${m.renewalMonths}か月ごと更新）` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[#909090]">
            更新が必要な資格を選ぶと、有効期限が空でも取得日から自動計算します。
          </p>
        </div>
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-[#555555]">
            資格名 *
          </label>
          <input id="name" name="name" required defaultValue={pick(v, "name", null)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="category" className="mb-1 block text-sm font-medium text-[#555555]">
            区分
          </label>
          <select
            id="category"
            name="category"
            key={`cat-${v?.category ?? ""}`}
            defaultValue={v?.category ?? "national"}
            className={INPUT}
          >
            {(Object.keys(QUALIFICATION_CATEGORY_LABEL) as (keyof typeof QUALIFICATION_CATEGORY_LABEL)[]).map(
              (c) => (
                <option key={c} value={c}>
                  {QUALIFICATION_CATEGORY_LABEL[c]}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <label htmlFor="acquiredOn" className="mb-1 block text-sm font-medium text-[#555555]">
            取得日
          </label>
          <input
            id="acquiredOn"
            name="acquiredOn"
            type="date"
            defaultValue={pick(v, "acquiredOn", null)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="expiresOn" className="mb-1 block text-sm font-medium text-[#555555]">
            有効期限
          </label>
          <input
            id="expiresOn"
            name="expiresOn"
            type="date"
            defaultValue={pick(v, "expiresOn", null)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="certificateNo" className="mb-1 block text-sm font-medium text-[#555555]">
            証書番号
          </label>
          <input
            id="certificateNo"
            name="certificateNo"
            defaultValue={pick(v, "certificateNo", null)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="issuer" className="mb-1 block text-sm font-medium text-[#555555]">
            交付元
          </label>
          <input id="issuer" name="issuer" defaultValue={pick(v, "issuer", null)} className={INPUT} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="note" className="mb-1 block text-sm font-medium text-[#555555]">
            備考
          </label>
          <input id="note" name="note" defaultValue={pick(v, "note", null)} className={INPUT} />
        </div>
      </div>

      {state.error && (
        <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}

      <div className="mt-4">
        <SubmitButton>登録する</SubmitButton>
      </div>
    </form>
  );
}

/** 保有資格の削除。 */
export function DeleteQualificationForm({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(deleteQualificationAction, {} as QualificationActionState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="label" value={label} />
      <SubmitButton
        variant="secondary"
        className="!px-2 !py-1 !text-xs"
        confirm={`「${label}」を削除します。よろしいですか？`}
      >
        削除
      </SubmitButton>
      {state.error && <p className="mt-1 text-xs text-[#b91c1c]">{state.error}</p>}
    </form>
  );
}

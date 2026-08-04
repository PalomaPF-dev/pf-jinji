"use client";

import { useActionState } from "react";
import Link from "next/link";
import SubmitButton from "./SubmitButton";
import type { ActionState } from "@/app/employees/actions";
import {
  EMPLOYMENT_STATUS_LABEL,
  EMPLOYMENT_STATUS_ORDER,
  EMPLOYMENT_TYPES,
  GENDER_LABEL,
  type Employee,
} from "@/lib/types";

export interface OrgOption {
  id: string;
  label: string;
  depth: number;
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-[#555555]">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-[#909090]">{hint}</p>}
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

/**
 * 社員の登録・編集フォーム。新規と編集で同じ入力欄を使う。
 */
export default function EmployeeForm({
  action,
  employee,
  orgOptions,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  employee?: Employee;
  orgOptions: OrgOption[];
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);

  return (
    <form action={formAction} className="space-y-6">
      {employee && <input type="hidden" name="id" value={employee.id} />}

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">基本情報</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="社員番号 *" htmlFor="employeeNo" hint="ポータルの社員番号と同じ値にしてください。">
            <input
              id="employeeNo"
              name="employeeNo"
              required
              defaultValue={employee?.employeeNo ?? ""}
              className={INPUT}
            />
          </Field>
          <Field label="氏名 *" htmlFor="name">
            <input id="name" name="name" required defaultValue={employee?.name ?? ""} className={INPUT} />
          </Field>
          <Field label="カナ" htmlFor="nameKana" hint="一覧の並び順に使います。">
            <input id="nameKana" name="nameKana" defaultValue={employee?.nameKana ?? ""} className={INPUT} />
          </Field>
          <Field label="性別" htmlFor="gender">
            <select id="gender" name="gender" defaultValue={employee?.gender ?? ""} className={INPUT}>
              <option value="">—</option>
              {(Object.keys(GENDER_LABEL) as (keyof typeof GENDER_LABEL)[]).map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABEL[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="生年月日" htmlFor="birthDate" hint="年齢は保存せず、この日付から都度計算します。">
            <input
              id="birthDate"
              name="birthDate"
              type="date"
              defaultValue={employee?.birthDate ?? ""}
              className={INPUT}
            />
          </Field>
          <Field label="入社日" htmlFor="hireDate">
            <input
              id="hireDate"
              name="hireDate"
              type="date"
              defaultValue={employee?.hireDate ?? ""}
              className={INPUT}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">所属・処遇</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="所属" htmlFor="orgUnitId" hint="異動は「異動申請書」から行うと履歴が残ります。">
            <select id="orgUnitId" name="orgUnitId" defaultValue={employee?.orgUnitId ?? ""} className={INPUT}>
              <option value="">（未配置）</option>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {"　".repeat(o.depth)}
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="雇用体系" htmlFor="employmentType">
            <input
              id="employmentType"
              name="employmentType"
              list="employment-types"
              defaultValue={employee?.employmentType ?? ""}
              className={INPUT}
            />
            <datalist id="employment-types">
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="役職" htmlFor="positionName">
            <input
              id="positionName"
              name="positionName"
              defaultValue={employee?.positionName ?? ""}
              className={INPUT}
            />
          </Field>
          <Field label="職務" htmlFor="dutyName">
            <input id="dutyName" name="dutyName" defaultValue={employee?.dutyName ?? ""} className={INPUT} />
          </Field>
          <Field label="等級" htmlFor="grade">
            <input id="grade" name="grade" defaultValue={employee?.grade ?? ""} className={INPUT} />
          </Field>
          <Field label="在籍状態 *" htmlFor="status">
            <select id="status" name="status" defaultValue={employee?.status ?? "active"} className={INPUT}>
              {EMPLOYMENT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYMENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="退職日" htmlFor="retireDate" hint="在籍状態が「退職」のときは必須です。">
            <input
              id="retireDate"
              name="retireDate"
              type="date"
              defaultValue={employee?.retireDate ?? ""}
              className={INPUT}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">連絡先・備考</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="メール" htmlFor="email">
            <input id="email" name="email" type="email" defaultValue={employee?.email ?? ""} className={INPUT} />
          </Field>
          <Field label="電話" htmlFor="phone">
            <input id="phone" name="phone" defaultValue={employee?.phone ?? ""} className={INPUT} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="備考" htmlFor="note">
              <textarea id="note" name="note" rows={3} defaultValue={employee?.note ?? ""} className={INPUT} />
            </Field>
          </div>
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>{employee ? "保存する" : "登録する"}</SubmitButton>
        <Link
          href={employee ? `/employees/${employee.id}` : "/employees"}
          className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          キャンセル
        </Link>
      </div>
    </form>
  );
}

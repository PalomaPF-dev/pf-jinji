"use client";

import { useActionState } from "react";
import Link from "next/link";
import SubmitButton from "./SubmitButton";
import { createOrgUnitAction, updateOrgUnitAction, type OrgActionState } from "@/app/org/actions";
import { ORG_KIND_LABEL, ORG_KIND_ORDER, type OrgUnit } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

export interface OrgParentOption {
  id: string;
  label: string;
  depth: number;
}

export interface EmployeeOption {
  id: string;
  employeeNo: string;
  name: string;
}

/**
 * 組織単位の追加・編集フォーム。
 * 上位組織を選ぶことで階層が決まる（ポータル側は平坦なまま）。
 */
export default function OrgUnitForm({
  unit,
  parentOptions,
  employees,
}: {
  unit?: OrgUnit;
  parentOptions: OrgParentOption[];
  employees: EmployeeOption[];
}) {
  const [state, formAction] = useActionState(
    unit ? updateOrgUnitAction : createOrgUnitAction,
    {} as OrgActionState,
  );

  return (
    <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-4 text-sm font-bold text-[#333333]">
        {unit ? `「${unit.name}」を編集` : "組織を追加"}
      </h2>
      {unit && <input type="hidden" name="id" value={unit.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="code" className="mb-1 block text-sm font-medium text-[#555555]">
            組織コード *
          </label>
          <input id="code" name="code" required defaultValue={unit?.code ?? ""} className={INPUT} />
          <p className="mt-1 text-xs text-[#909090]">CSV取込の「所属コード」に使います。</p>
        </div>
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-[#555555]">
            組織名 *
          </label>
          <input id="name" name="name" required defaultValue={unit?.name ?? ""} className={INPUT} />
        </div>
        <div>
          <label htmlFor="kind" className="mb-1 block text-sm font-medium text-[#555555]">
            階層区分
          </label>
          <select id="kind" name="kind" defaultValue={unit?.kind ?? "ka"} className={INPUT}>
            {ORG_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {ORG_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="parentId" className="mb-1 block text-sm font-medium text-[#555555]">
            上位組織
          </label>
          <select id="parentId" name="parentId" defaultValue={unit?.parentId ?? ""} className={INPUT}>
            <option value="">（最上位）</option>
            {parentOptions
              .filter((o) => o.id !== unit?.id)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {"　".repeat(o.depth)}
                  {o.label}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="headEmployeeId" className="mb-1 block text-sm font-medium text-[#555555]">
            組織の長
          </label>
          <select
            id="headEmployeeId"
            name="headEmployeeId"
            defaultValue={unit?.headEmployeeId ?? ""}
            className={INPUT}
          >
            <option value="">—</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}（{e.employeeNo}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="mb-1 block text-sm font-medium text-[#555555]">
            並び順
          </label>
          <input
            id="sort"
            name="sort"
            type="number"
            defaultValue={unit?.sort ?? 0}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#909090]">同じ階層の中で小さい順に並びます。</p>
        </div>
        <div>
          <label htmlFor="validFrom" className="mb-1 block text-sm font-medium text-[#555555]">
            有効期間（開始）
          </label>
          <input
            id="validFrom"
            name="validFrom"
            type="date"
            defaultValue={unit?.validFrom ?? ""}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="validTo" className="mb-1 block text-sm font-medium text-[#555555]">
            有効期間（終了）
          </label>
          <input
            id="validTo"
            name="validTo"
            type="date"
            defaultValue={unit?.validTo ?? ""}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-[#909090]">
            未入力なら常に有効。組織改編の記録を残したいときだけ入れます。
          </p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-[#555555]">
            説明
          </label>
          <input
            id="description"
            name="description"
            defaultValue={unit?.description ?? ""}
            className={INPUT}
          />
        </div>
      </div>

      {state.error && (
        <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton>{unit ? "保存する" : "追加する"}</SubmitButton>
        {unit && (
          <Link
            href="/org/edit"
            className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            編集をやめる
          </Link>
        )}
      </div>
    </form>
  );
}

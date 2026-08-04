"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import {
  createQualificationMasterAction,
  deleteQualificationMasterAction,
  type QualificationActionState,
} from "@/app/qualifications/actions";
import { pick } from "@/lib/formState";
import { QUALIFICATION_CATEGORY_LABEL } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

/** 資格マスターの追加（設定画面）。 */
export default function QualificationMasterForm() {
  const [state, action] = useActionState(createQualificationMasterAction, {} as QualificationActionState);
  const v = state.values;

  return (
    <form action={action} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">資格マスターの追加</h2>
      <p className="mb-4 text-xs text-[#707070]">
        更新が必要な資格は更新間隔を入れておくと、保有資格の登録時に有効期限を自動計算します。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="qcode" className="mb-1 block text-sm font-medium text-[#555555]">
            資格コード *
          </label>
          <input id="qcode" name="code" required defaultValue={pick(v, "code", null)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="qname" className="mb-1 block text-sm font-medium text-[#555555]">
            資格名 *
          </label>
          <input id="qname" name="name" required defaultValue={pick(v, "name", null)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="qcategory" className="mb-1 block text-sm font-medium text-[#555555]">
            区分
          </label>
          <select
            id="qcategory"
            name="category"
            key={`qcat-${v?.category ?? ""}`}
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
          <label htmlFor="qsort" className="mb-1 block text-sm font-medium text-[#555555]">
            並び順
          </label>
          <input id="qsort" name="sort" type="number" defaultValue={v?.sort ?? "0"} className={INPUT} />
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-[#555555]">
            <input type="checkbox" name="renewalRequired" defaultChecked={v?.renewalRequired === "on"} />
            更新が必要
          </label>
          <div>
            <label htmlFor="qmonths" className="mb-1 block text-xs font-medium text-[#707070]">
              更新間隔（月）
            </label>
            <input
              id="qmonths"
              name="renewalMonths"
              type="number"
              min={1}
              defaultValue={pick(v, "renewalMonths", null)}
              className="w-28 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
          </div>
        </div>
      </div>

      {state.error && (
        <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-4 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}

      <div className="mt-4">
        <SubmitButton>追加する</SubmitButton>
      </div>
    </form>
  );
}

/** 資格マスターの削除（取得実績は残る）。 */
export function DeleteQualificationMasterForm({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(deleteQualificationMasterAction, {} as QualificationActionState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="label" value={label} />
      <SubmitButton
        variant="secondary"
        className="!px-2 !py-1 !text-xs"
        confirm={`資格マスターから「${label}」を削除します。登録済みの取得実績は残ります。よろしいですか？`}
      >
        削除
      </SubmitButton>
      {state.error && <p className="mt-1 text-xs text-[#b91c1c]">{state.error}</p>}
    </form>
  );
}

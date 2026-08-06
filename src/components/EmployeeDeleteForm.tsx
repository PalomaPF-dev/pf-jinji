"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { deleteEmployeeAction, type ActionState } from "@/app/employees/actions";

/**
 * 社員カードの削除。
 *
 * 取り消せない操作なので、社員番号を打ち直してもらってから実行する。
 * 「退職を記録したいだけ」の人が誤って消さないよう、先に在籍状態の変更を案内する。
 */
function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#b91c1c] px-3 py-2 text-sm font-medium text-white hover:bg-[#991b1b] disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
      {pending ? "削除中…" : "社員カードを削除する"}
    </button>
  );
}

export default function EmployeeDeleteForm({
  id,
  employeeNo,
  name,
}: {
  id: string;
  employeeNo: string;
  name: string;
}) {
  const [state, formAction] = useActionState(deleteEmployeeAction, {} as ActionState);
  return (
    <form action={formAction} className="rounded-xl border border-[#f0c8c8] bg-[#fdf5f5] p-5">
      <h2 className="mb-1 text-sm font-bold text-[#b91c1c]">社員カードを削除する</h2>
      <p className="mb-1 text-xs text-[#7a3a3a]">
        <strong>{name}</strong>（{employeeNo}）のカードと、そこにぶら下がる
        <strong>異動申請・継続雇用申請・人事考課・基本給与・保有資格・兼務</strong>をすべて削除します。
        <strong>取り消せません。</strong>
      </p>
      <p className="mb-3 text-xs text-[#7a3a3a]">
        退職を記録したいだけなら、削除せず<strong>編集画面で在籍状態を「退職」</strong>にしてください。
        履歴が残り、組織図と人数からも外れます。
      </p>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="confirm"
          defaultValue={state.values?.confirm ?? ""}
          placeholder={employeeNo}
          aria-label={`確認のため社員番号 ${employeeNo} を入力`}
          className="w-40 rounded-lg border border-[#e5c8c8] bg-white px-3 py-2 text-sm outline-none focus:border-[#b91c1c]"
        />
        <DeleteButton />
      </div>
      <p className="mt-1 text-[11px] text-[#a06a6a]">
        確認のため、社員番号「{employeeNo}」を入力してから押してください。
      </p>
      {state.error && (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
    </form>
  );
}

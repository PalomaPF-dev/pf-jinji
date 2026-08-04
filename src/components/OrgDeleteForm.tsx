"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { deleteOrgUnitAction, type OrgActionState } from "@/app/org/actions";

function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(`「${name}」を削除します。よろしいですか？`)) e.preventDefault();
      }}
      className="inline-flex items-center gap-1 text-xs text-[#b91c1c] hover:underline disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" />
      削除
    </button>
  );
}

/** 組織単位の削除。所属者が居る場合はサーバー側で拒否される。 */
export default function OrgDeleteForm({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(deleteOrgUnitAction, {} as OrgActionState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <DeleteButton name={name} />
      {state.error && <p className="mt-1 text-xs text-[#b91c1c]">{state.error}</p>}
    </form>
  );
}

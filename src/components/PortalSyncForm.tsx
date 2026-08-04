"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { syncPortalAction, type OrgActionState } from "@/app/org/actions";

function SyncButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {pending ? "同期中…" : "ポータルの部署を同期"}
    </button>
  );
}

/**
 * ポータル部署マスターの取込。
 * 取り込むのは名称と存在まで。階層・並び順・上長は人事側の設定を上書きしない。
 */
export default function PortalSyncForm() {
  const [state, formAction] = useActionState(syncPortalAction, {} as OrgActionState);

  return (
    <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">ポータル部署マスターとの連動</h2>
      <p className="mb-3 text-xs text-[#707070]">
        ポータルの部署・職場を取り込みます。取り込むのは<strong>名称と存在</strong>までで、
        階層・並び順・組織の長はこの画面の設定を維持します。
        ポータルから消えた組織は自動削除せず、注意として表示します。
      </p>
      <SyncButton />
      {state.error && (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}
    </form>
  );
}

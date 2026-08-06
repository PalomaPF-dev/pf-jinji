"use client";

import { useActionState } from "react";
import { Network, RefreshCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { restructureOrgAction, syncPortalAction, type OrgActionState } from "@/app/org/actions";

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

function RestructureButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
    >
      <Network className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
      {pending ? "整理中…" : "4階層に組み直す"}
    </button>
  );
}

/**
 * 所属組織コード（8桁）の上位4桁から中間層を組み、
 * 本部 → 部・工場 → 室・共通・総務 → それ以外の職場 の4階層にする。
 * 名簿取込のたびにも自動で走る。
 */
export function RestructureForm() {
  const [state, formAction] = useActionState(restructureOrgAction, {} as OrgActionState);
  return (
    <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">階層の自動整理</h2>
      <p className="mb-3 text-xs text-[#707070]">
        名簿は「本部 → 所属組織」の2階層しか持っていないので、所属組織コード（8桁）の
        上位4桁から中間層を組み、組織図を次の4階層にします。
      </p>
      <ul className="mb-3 space-y-0.5 text-xs text-[#707070]">
        <li>
          第1階層 <span className="text-[#909090]">本部</span>
        </li>
        <li>
          第2階層 <strong>部・工場</strong>{" "}
          <span className="text-[#909090]">大口工場 / 調達部 / ロジスティクス部 …</span>
        </li>
        <li>
          第3階層 <strong>室・共通・総務</strong>{" "}
          <span className="text-[#909090]">大口安全推進工場長室 / 大口組立共通 / 調達室 …</span>
        </li>
        <li>
          第4階層 <strong>それ以外の職場</strong>{" "}
          <span className="text-[#909090]">大口ﾌﾟﾚｽ1 / 大口品質管理 / 大江配送センター …</span>
        </li>
      </ul>
      <p className="mb-3 text-xs text-[#707070]">
        名簿の取込時にも自動で実行されます。何度押しても同じ形になります。
        <strong>取込より前に配置表で組み替えた階層は、この規則で上書きされます。</strong>
      </p>
      <RestructureButton />
      {state.error && (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}
    </form>
  );
}

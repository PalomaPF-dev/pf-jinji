"use client";

import { useActionState } from "react";
import { FileText, Trash2 } from "lucide-react";
import SubmitButton from "./SubmitButton";
import {
  createOrgPlanAction,
  deleteOrgPlanAction,
  issueTransfersAction,
  removeMoveAction,
  updateOrgPlanAction,
  type OrgPlanActionState,
} from "@/app/org/plan/actions";
import type { OrgPlan } from "@/lib/orgPlans";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

function Notice({ state }: { state: OrgPlanActionState }) {
  if (state.error) {
    return <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>;
  }
  if (state.message) {
    return <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>;
  }
  return null;
}

export function NewOrgPlanForm() {
  const [state, action] = useActionState(createOrgPlanAction, {} as OrgPlanActionState);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <div>
        <label htmlFor="name" className="mb-1 block text-xs font-medium text-[#707070]">
          案の名前
        </label>
        <input id="name" name="name" placeholder="2026年4月 定期異動" className={INPUT} />
      </div>
      <div>
        <label htmlFor="baseDate" className="mb-1 block text-xs font-medium text-[#707070]">
          基準日
        </label>
        <input id="baseDate" name="baseDate" type="date" className={INPUT} />
      </div>
      <div>
        <label htmlFor="effectiveDate" className="mb-1 block text-xs font-medium text-[#707070]">
          発令予定日
        </label>
        <input id="effectiveDate" name="effectiveDate" type="date" className={INPUT} />
      </div>
      <SubmitButton>作成</SubmitButton>
      <div className="sm:col-span-4">
        <Notice state={state} />
      </div>
    </form>
  );
}

/** 案の見出し（名前・日付・メモ）の編集。 */
export function EditOrgPlanForm({ plan }: { plan: OrgPlan }) {
  const [state, action] = useActionState(updateOrgPlanAction, {} as OrgPlanActionState);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={plan.id} />
      <div>
        <label htmlFor="pname" className="mb-1 block text-xs font-medium text-[#707070]">
          案の名前
        </label>
        <input id="pname" name="name" defaultValue={plan.name} className={INPUT} />
      </div>
      <div>
        <label htmlFor="pbase" className="mb-1 block text-xs font-medium text-[#707070]">
          基準日
        </label>
        <input id="pbase" name="baseDate" type="date" defaultValue={plan.baseDate ?? ""} className={INPUT} />
      </div>
      <div>
        <label htmlFor="peff" className="mb-1 block text-xs font-medium text-[#707070]">
          発令予定日 <span className="text-[#909090]">（確定に必要）</span>
        </label>
        <input
          id="peff"
          name="effectiveDate"
          type="date"
          defaultValue={plan.effectiveDate ?? ""}
          className={INPUT}
        />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor="pnote" className="mb-1 block text-xs font-medium text-[#707070]">
          メモ
        </label>
        <textarea id="pnote" name="note" rows={2} defaultValue={plan.note ?? ""} className={INPUT} />
      </div>
      <div className="sm:col-span-3 flex items-center gap-2">
        <SubmitButton variant="secondary">保存</SubmitButton>
      </div>
      <div className="sm:col-span-3">
        <Notice state={state} />
      </div>
    </form>
  );
}

/** 案から異動申請書を起こす。戻せない操作なので確認を挟む。 */
export function IssueTransfersForm({ plan }: { plan: OrgPlan }) {
  const [state, action] = useActionState(issueTransfersAction, {} as OrgPlanActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={plan.id} />
      <SubmitButton
        confirm={`この案の ${plan.moveCount} 名ぶんの異動申請書を作成します。よろしいですか？`}
      >
        <FileText className="h-4 w-4" />
        異動申請書を作成（{plan.moveCount} 件）
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

export function DeleteOrgPlanForm({ plan }: { plan: OrgPlan }) {
  const [state, action] = useActionState(deleteOrgPlanAction, {} as OrgPlanActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={plan.id} />
      <SubmitButton variant="danger" confirm={`異動案「${plan.name}」を削除します。よろしいですか？`}>
        <Trash2 className="h-4 w-4" />
        削除
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

/** 1件の動きを案から取り消す。 */
export function RemoveMoveForm({ planId, employeeId }: { planId: string; employeeId: string }) {
  const [, action] = useActionState(removeMoveAction, {} as OrgPlanActionState);
  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <button type="submit" className="text-xs text-[#b91c1c] hover:underline">
        取り消す
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { Check, RefreshCw, Send, Stamp, Trash2, Undo2, UserCog } from "lucide-react";
import SubmitButton from "./SubmitButton";
import {
  applyTransferAction,
  decideApprovalAction,
  deleteTransferAction,
  refreshDeptHeadAction,
  setApproverAction,
  submitTransferAction,
  type TransferActionState,
} from "@/app/transfers/actions";
import { formatDateTime } from "@/lib/format";
import type { Transfer, TransferApproval } from "@/lib/types";

function Notice({ state }: { state: TransferActionState }) {
  if (state.error) {
    return <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>;
  }
  if (state.message) {
    return <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>;
  }
  return null;
}

/** 起案中／差戻 → 申請中。 */
export function SubmitTransferForm({ id }: { id: string }) {
  const [state, action] = useActionState(submitTransferAction, {} as TransferActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton>
        <Send className="h-4 w-4" />
        申請する
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

/**
 * 承認欄（捺印枠）。申請中のときだけ押せる。
 * 1枠でも差戻があれば申請全体が差戻に戻り、全枠承認で承認済みになる。
 */
export function ApprovalPanel({
  transfer,
  approvals,
}: {
  transfer: Transfer;
  approvals: TransferApproval[];
}) {
  const [state, action] = useActionState(decideApprovalAction, {} as TransferActionState);
  const editable = transfer.status === "submitted";
  // 担当は発令前ならいつでも直せる（申請してから役員が決まることがあるため）
  const canAssign = transfer.status !== "issued";

  return (
    <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[#333333]">
        <Stamp className="h-4 w-4" />
        承認欄
      </h2>
      <p className="mb-4 text-xs text-[#707070]">
        {editable
          ? "全員の承認が揃うと発令できます。1人でも差し戻すと申請中から起案中に戻ります。"
          : "申請中の申請書だけが承認・差戻できます。"}
      </p>

      <div className="space-y-2">
        {approvals.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#e5e5e5] px-3 py-2"
          >
            <span className="w-16 shrink-0 text-sm font-medium text-[#555555]">{a.label}</span>
            {a.assigneeName ? (
              <span className="text-xs text-[#555555]">
                担当 {a.assigneeName}
                <span className="ml-1 font-mono text-[10px] text-[#a0a0a0]">{a.assigneeLoginId}</span>
              </span>
            ) : (
              <span className="text-xs text-[#a0a0a0]">担当 未設定</span>
            )}
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                a.decision === "approved"
                  ? "bg-[#e8f3ec] text-[#1c7a4d]"
                  : a.decision === "rejected"
                    ? "bg-[#fdecec] text-[#b91c1c]"
                    : "bg-[#f0f0f0] text-[#909090]"
              }`}
            >
              {a.decision === "approved" ? "承認" : a.decision === "rejected" ? "差戻" : "未"}
            </span>
            {a.approverName && (
              <span className="text-xs text-[#707070]">
                {a.approverName} / {formatDateTime(a.decidedAt)}
              </span>
            )}
            {a.comment && <span className="text-xs text-[#909090]">「{a.comment}」</span>}
            {editable && (
              <form action={action} className="ml-auto flex items-center gap-1.5">
                <input type="hidden" name="id" value={transfer.id} />
                <input type="hidden" name="slot" value={a.slot} />
                <input
                  name="comment"
                  placeholder="コメント（任意）"
                  className="w-40 rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs outline-none focus:border-[#2563eb]"
                />
                <button
                  type="submit"
                  name="decision"
                  value="approved"
                  className="inline-flex items-center gap-1 rounded-lg bg-[#2563eb] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1d4ed8]"
                >
                  <Check className="h-3.5 w-3.5" />
                  承認
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="rejected"
                  className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-2.5 py-1.5 text-xs font-medium text-[#b91c1c] hover:bg-[#fdf6f6]"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  差戻
                </button>
              </form>
            )}
            {canAssign && a.slot !== "applicant" && (
              <div className="w-full">
                <AssigneeForm id={transfer.id} slot={a.slot} label={a.label} />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[#909090]">
        担当を決めた欄は、その人（またはポータル管理者）だけが押せます。
        担当が未設定の欄はこれまでどおり誰でも押せます。
      </p>
      <Notice state={state} />
    </section>
  );
}

/** 承認欄の担当を社員番号で指定する。部門長は申請部署から当て直せる。 */
function AssigneeForm({ id, slot, label }: { id: string; slot: string; label: string }) {
  const [state, action] = useActionState(setApproverAction, {} as TransferActionState);
  const [refreshState, refresh] = useActionState(refreshDeptHeadAction, {} as TransferActionState);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-[#f4f4f4] pt-2">
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="slot" value={slot} />
        <UserCog className="h-3.5 w-3.5 text-[#a0a0a0]" />
        <input
          name="employeeNo"
          placeholder="社員番号"
          aria-label={`${label}の担当を社員番号で指定`}
          className="w-28 rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs outline-none focus:border-[#2563eb]"
        />
        <button
          type="submit"
          className="rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          担当にする
        </button>
      </form>
      {slot === "dept_head" && (
        <form action={refresh}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            title="申請部署の部・工場の長を当て直す"
            className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <RefreshCw className="h-3 w-3" />
            申請部署から当て直す
          </button>
        </form>
      )}
      {(state.error || refreshState.error) && (
        <span className="text-xs text-[#b91c1c]">{state.error ?? refreshState.error}</span>
      )}
      {(state.message || refreshState.message) && (
        <span className="text-xs text-[#1c7a4d]">{state.message ?? refreshState.message}</span>
      )}
    </div>
  );
}

/** 申請書の削除。発令済みは消せない（人事マスターへ反映済みのため）。 */
export function DeleteTransferForm({ id, no, name }: { id: string; no: string; name: string }) {
  const [state, action] = useActionState(deleteTransferAction, {} as TransferActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="danger" confirm={`${no}（${name}）の申請書を削除します。よろしいですか？`}>
        <Trash2 className="h-4 w-4" />
        申請書を削除
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

/**
 * 発令適用。人事マスターへ反映する戻せない操作なので、確認ダイアログを挟む。
 */
export function ApplyTransferForm({ transfer }: { transfer: Transfer }) {
  const [state, action] = useActionState(applyTransferAction, {} as TransferActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={transfer.id} />
      <SubmitButton
        confirm={`${transfer.employeeName} さんの異動を発令し、人事マスターへ反映します。この操作は取り消せません。よろしいですか？`}
      >
        発令して人事マスターへ反映
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

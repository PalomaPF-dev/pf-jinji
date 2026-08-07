"use client";

import { useActionState } from "react";
import { Check, Send, Stamp, Trash2, Undo2, UserCog } from "lucide-react";
import SubmitButton from "./SubmitButton";
import {
  decideReemploymentApprovalAction,
  deleteReemploymentAction,
  setReemploymentApproverAction,
  submitReemploymentAction,
  type ReemploymentActionState,
} from "@/app/reemployments/actions";
import { formatDateTime } from "@/lib/format";
import type { Reemployment, ReemploymentApproval } from "@/lib/types";

/**
 * 継続雇用申請書（J-456）の申請・承認の導線。
 * 異動申請と同じ操作感に揃えてあるが、**発令（人事マスターへの反映）は無い**。
 */

function Notice({ state }: { state: ReemploymentActionState }) {
  if (state.error) {
    return <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>;
  }
  if (state.message) {
    return <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>;
  }
  return null;
}

/** 起案中／差戻 → 申請中。 */
export function SubmitReemploymentForm({ id }: { id: string }) {
  const [state, action] = useActionState(submitReemploymentAction, {} as ReemploymentActionState);
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

/** 起案中・差戻のあいだだけ削除できる。 */
export function DeleteReemploymentForm({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(deleteReemploymentAction, {} as ReemploymentActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        variant="danger"
        confirm={`${name} さんの継続雇用申請書を削除します。よろしいですか？`}
      >
        <Trash2 className="h-4 w-4" />
        削除
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

/**
 * 承認欄（捺印枠）。申請中のときだけ押せる。
 * 1枠でも差戻があれば申請全体が差戻に戻り、全枠承認で承認済みになる。
 */
export function ReemploymentApprovalPanel({
  reemployment,
  approvals,
}: {
  reemployment: Reemployment;
  approvals: ReemploymentApproval[];
}) {
  const [state, action] = useActionState(
    decideReemploymentApprovalAction,
    {} as ReemploymentActionState,
  );
  const editable = reemployment.status === "submitted";
  // 担当は承認が済むまでいつでも直せる（申請してから役員が決まることがあるため）
  const canAssign = reemployment.status !== "approved";

  return (
    <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[#333333]">
        <Stamp className="h-4 w-4" />
        承認欄
      </h2>
      <p className="mb-4 text-xs text-[#707070]">
        {editable
          ? "全員の承認が揃うと承認済みになります。1人でも差し戻すと起案中に戻ります。"
          : "申請中の申請書だけが承認・差戻できます。"}
      </p>

      <div className="space-y-2">
        {approvals.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#e5e5e5] px-3 py-2"
          >
            <span className="w-24 shrink-0 text-sm font-medium text-[#555555]">{a.label}</span>
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
                <input type="hidden" name="id" value={reemployment.id} />
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
                <AssigneeForm id={reemployment.id} slot={a.slot} label={a.label} />
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

/** 承認欄の担当を社員番号で指定する。 */
function AssigneeForm({ id, slot, label }: { id: string; slot: string; label: string }) {
  const [state, action] = useActionState(
    setReemploymentApproverAction,
    {} as ReemploymentActionState,
  );
  return (
    <form
      action={action}
      className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-[#f4f4f4] pt-2"
    >
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
      {state.error && <span className="text-xs text-[#b91c1c]">{state.error}</span>}
      {state.message && <span className="text-xs text-[#1c7a4d]">{state.message}</span>}
    </form>
  );
}

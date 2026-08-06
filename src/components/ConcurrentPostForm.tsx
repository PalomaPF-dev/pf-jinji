"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import {
  addConcurrentPostAction,
  deleteConcurrentPostAction,
  type ActionState,
} from "@/app/employees/actions";
import type { ConcurrentPost } from "@/lib/concurrentPosts";
import { formatDate } from "@/lib/format";

/**
 * 社員カードの兼務欄。
 *
 * 兼務は「本務のほかに、この組織の仕事も持っている」という関係なので、
 * 本務の編集画面（1つの所属を選ぶ画面）には収まらない。行の足し引きとして別に置く。
 *
 * 役職・職務は**兼務先で違うときだけ**入れてもらう（空なら本務の値を使う）。
 * 毎回2つ埋めさせると、本務と同じ値の写し間違いが入るため。
 */

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
    >
      <Plus className="h-4 w-4" />
      {pending ? pendingLabel : label}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title="この兼務を削除する"
      className="rounded-lg p-1.5 text-[#909090] hover:bg-[#fdecec] hover:text-[#b91c1c] disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function DeleteRow({ id, employeeId }: { id: string; employeeId: string }) {
  const [state, formAction] = useActionState(deleteConcurrentPostAction, {} as ActionState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <DeleteButton />
      {state.error && <span className="ml-2 text-xs text-[#b91c1c]">{state.error}</span>}
    </form>
  );
}

const field =
  "w-full rounded-lg border border-[#e5e5e5] px-2.5 py-1.5 text-sm outline-none focus:border-[#2563eb]";
const label = "mb-1 block text-xs font-medium text-[#707070]";

export default function ConcurrentPostForm({
  employeeId,
  homeOrgName,
  posts,
  orgOptions,
}: {
  employeeId: string;
  homeOrgName: string | null;
  posts: ConcurrentPost[];
  orgOptions: { id: string; label: string; depth: number }[];
}) {
  const [state, formAction] = useActionState(addConcurrentPostAction, {} as ActionState);
  const v = state.values ?? {};

  return (
    <div>
      {posts.length === 0 ? (
        <p className="mb-3 text-sm text-[#909090]">兼務はありません。</p>
      ) : (
        <ul className="mb-3 divide-y divide-[#f0f0f0] border-y border-[#f0f0f0]">
          {posts.map((p) => (
            <li key={p.id} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#333333]">{p.orgUnitName}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[#707070]">
                  {p.positionName && <span>役職 {p.positionName}</span>}
                  {p.dutyName && <span>職務 {p.dutyName}</span>}
                  {(p.startedOn || p.endedOn) && (
                    <span>
                      {p.startedOn ? formatDate(p.startedOn) : "—"} 〜{" "}
                      {p.endedOn ? formatDate(p.endedOn) : ""}
                    </span>
                  )}
                </div>
                {p.note && <div className="mt-0.5 text-xs text-[#909090]">{p.note}</div>}
              </div>
              <DeleteRow id={p.id} employeeId={employeeId} />
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3">
        <input type="hidden" name="employeeId" value={employeeId} />
        <div className="mb-2">
          <label htmlFor="cp-org" className={label}>
            兼務先の組織
          </label>
          <select id="cp-org" name="orgUnitId" defaultValue={v.orgUnitId ?? ""} className={field}>
            <option value="">選択してください</option>
            {orgOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {"　".repeat(o.depth)}
                {o.label}
              </option>
            ))}
          </select>
          {homeOrgName && (
            <p className="mt-1 text-[11px] text-[#a0a0a0]">本務は「{homeOrgName}」です。</p>
          )}
        </div>

        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="cp-position" className={label}>
              役職（兼務先で違うときだけ）
            </label>
            <input
              id="cp-position"
              name="positionName"
              defaultValue={v.positionName ?? ""}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="cp-duty" className={label}>
              職務（兼務先で違うときだけ）
            </label>
            <input id="cp-duty" name="dutyName" defaultValue={v.dutyName ?? ""} className={field} />
          </div>
        </div>

        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="cp-from" className={label}>
              開始日
            </label>
            <input
              id="cp-from"
              name="startedOn"
              type="date"
              defaultValue={v.startedOn ?? ""}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="cp-to" className={label}>
              終了日（決まっていれば）
            </label>
            <input
              id="cp-to"
              name="endedOn"
              type="date"
              defaultValue={v.endedOn ?? ""}
              className={field}
            />
          </div>
        </div>

        <div className="mb-3">
          <label htmlFor="cp-note" className={label}>
            備考
          </label>
          <input id="cp-note" name="note" defaultValue={v.note ?? ""} className={field} />
        </div>

        <SubmitButton label="兼務を追加" pendingLabel="追加中…" />

        {state.error && (
          <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
        )}
        {state.message && (
          <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}

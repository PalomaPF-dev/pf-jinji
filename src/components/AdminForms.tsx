"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import SubmitButton from "./SubmitButton";
import {
  clearAuditLogsAction,
  issueLinkAction,
  resetHrDataAction,
  removeAdminAction,
  upsertAdminAction,
  type SettingsActionState,
} from "@/app/settings/actions";
import { pick } from "@/lib/formState";
import type { JinjiAdmin } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

function Notice({ state }: { state: SettingsActionState }) {
  return (
    <>
      {state.error && (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}
      {state.inviteUrl && (
        <p className="mt-2 break-all rounded-lg bg-[#f7f7f5] px-3 py-2 font-mono text-xs text-[#555555]">
          {state.inviteUrl}
        </p>
      )}
    </>
  );
}

/**
 * 責任者名簿の追加・更新。
 * 既にいる社員番号を入れると更新になる。
 */
export default function AdminUpsertForm({ editing }: { editing?: JinjiAdmin }) {
  const [state, action] = useActionState(upsertAdminAction, {} as SettingsActionState);
  const v = state.values;

  return (
    <form action={action} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">
        {editing ? `「${editing.name}」を変更` : "責任者を追加"}
      </h2>
      <p className="mb-4 text-xs text-[#707070]">
        通常のアクセス可否はポータルの権限で決まります。この名簿は、ポータルの権限が
        届かない状態でもアプリに入れる<strong>入室の控え</strong>です。
        既にいる社員番号を入れると更新になります。
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="loginId" className="mb-1 block text-sm font-medium text-[#555555]">
            社員番号 *
          </label>
          <input
            id="loginId"
            name="loginId"
            required
            readOnly={Boolean(editing)}
            defaultValue={pick(v, "loginId", editing?.loginId)}
            className={`${INPUT} read-only:bg-[#fafafa]`}
          />
        </div>
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-[#555555]">
            お名前 *
          </label>
          <input id="name" name="name" required defaultValue={pick(v, "name", editing?.name)} className={INPUT} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="note" className="mb-1 block text-sm font-medium text-[#555555]">
            メモ
          </label>
          <input id="note" name="note" defaultValue={pick(v, "note", editing?.note)} className={INPUT} />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-[#555555]">権限</legend>
        <label className="flex items-start gap-2 text-sm text-[#555555]">
          <input
            type="checkbox"
            name="isOwner"
            className="mt-1"
            defaultChecked={v ? v.isOwner === "on" : (editing?.isOwner ?? false)}
          />
          <span>
            責任者（owner）
            <span className="block text-xs text-[#909090]">
              ポータルの権限に関わらず入室できます。ただし人事考課・基本給与・設定は
            ポータル管理者（ポータル管理権限）だけのもので、名簿では開けません。
            </span>
          </span>
        </label>
      </fieldset>

      <Notice state={state} />

      <div className="mt-4">
        <SubmitButton>{editing ? "保存" : "名簿に追加"}</SubmitButton>
      </div>
    </form>
  );
}

/** 名簿から外す。 */
export function RemoveAdminForm({ loginId, name }: { loginId: string; name: string }) {
  const [state, action] = useActionState(removeAdminAction, {} as SettingsActionState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="loginId" value={loginId} />
      <SubmitButton
        variant="secondary"
        className="!px-2 !py-1 !text-xs"
        confirm={`${name}（${loginId}）を名簿から外します。外すとこのアプリを使えなくなります。よろしいですか？`}
      >
        名簿から外す
      </SubmitButton>
      {state.error && <p className="mt-1 text-xs text-[#b91c1c]">{state.error}</p>}
    </form>
  );
}

/** パスワード設定リンクの発行。 */
export function IssueLinkForm({ loginId, name }: { loginId: string; name: string }) {
  const [state, action] = useActionState(issueLinkAction, {} as SettingsActionState);
  return (
    <form action={action}>
      <input type="hidden" name="loginId" value={loginId} />
      <input type="hidden" name="name" value={name} />
      <SubmitButton variant="secondary" className="!px-2 !py-1 !text-xs">
        設定リンクを発行
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

/**
 * 監査ログの全件削除。
 *
 * 取込を回すと1回で数百件積み上がるため、棚卸しできるようにしてある。
 * 押し間違いが痛い操作なので、確認を挟む。
 */
export function ClearAuditLogsForm({ count }: { count: number }) {
  const [state, formAction] = useActionState(clearAuditLogsAction, {} as SettingsActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <ClearButton count={count} />
      {state.error && <span className="text-xs text-[#b91c1c]">{state.error}</span>}
      {state.message && <span className="text-xs text-[#1c7a4d]">{state.message}</span>}
    </form>
  );
}

function ClearButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      onClick={(e) => {
        if (
          !window.confirm(
            "監査ログをすべて削除します。誰がいつ何をしたかの記録が消え、元に戻せません。よろしいですか？",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-[#f0d0d0] px-3 py-1.5 text-xs font-medium text-[#b91c1c] hover:bg-[#fdf5f5] disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" />
      監査ログをすべて削除
    </button>
  );
}

/**
 * 人事データの初期化。名簿を取り込み直すときに使う。
 *
 * 取り消せない操作なので、確認の言葉を打ってもらう。ボタンだけだと押し間違いが
 * 起きるうえ、何が消えるかを読まずに実行されてしまうため。
 */
export function ResetHrDataForm({ employees, orgUnits }: { employees: number; orgUnits: number }) {
  const [state, formAction] = useActionState(resetHrDataAction, {} as SettingsActionState);
  return (
    <form action={formAction} className="rounded-xl border border-[#f0d0d0] bg-[#fdf5f5] p-5">
      <h3 className="mb-1 text-sm font-bold text-[#b91c1c]">人事データを初期化する</h3>
      <p className="mb-3 text-xs text-[#8a5050]">
        <strong>社員台帳 {employees} 件</strong>と<strong>組織 {orgUnits} 件</strong>、
        それにぶら下がる異動申請・継続雇用申請・人事考課・基本給与・保有資格・兼務・異動案を
        すべて削除します。名簿を取り込み直すときに使ってください。
        <br />
        利用許可名簿・資格マスター・考課項目・監査ログ・ログイン情報は残ります。
        <strong>取り消せません。</strong>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="confirm"
          placeholder="削除する"
          aria-label="確認の言葉"
          className="w-40 rounded-lg border border-[#e0c0c0] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#b91c1c]"
        />
        <ResetButton />
        {state.error && <span className="text-xs text-[#b91c1c]">{state.error}</span>}
      </div>
      {state.message && (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}
    </form>
  );
}

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (
          !window.confirm(
            "社員台帳と組織をすべて削除します。取り消せません。本当に実行しますか？",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg bg-[#b91c1c] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#991b1b] disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
      初期化する
    </button>
  );
}

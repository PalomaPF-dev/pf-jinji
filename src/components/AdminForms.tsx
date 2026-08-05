"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import {
  issueLinkAction,
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
        届かない状態でもアプリを管理できる<strong>責任者の控え</strong>です。
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
              ポータルの権限に関わらず入室でき、給与・考課・設定を含む全機能を扱えます。
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

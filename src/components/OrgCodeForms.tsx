"use client";

import { useActionState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  createOrgUnitAction,
  deleteOrgUnitAction,
  updateOrgCodesAction,
  type OrgActionState,
} from "@/app/org/actions";
import { pick } from "@/lib/formState";
import type { OrgParentOption } from "./OrgUnitForm";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 font-mono text-xs outline-none focus:border-[#2563eb]";
const INPUT_L =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

/**
 * 1行ぶんの編集。組織名・部署コード・職場コードを直す。
 * 階層（上位組織）と組織の長は「組織の編集」で扱うので、ここでは触らない
 * （名称とコードの棚卸しをしているときに、うっかり階層を変えてしまわないように）。
 */
export function OrgCodeRowForm({
  id,
  name,
  deptCode,
  workplaceCode,
}: {
  id: string;
  name: string;
  deptCode: string | null;
  workplaceCode: string | null;
}) {
  const [state, formAction] = useActionState(updateOrgCodesAction, {} as OrgActionState);
  const v = state.values;
  return (
    <form action={formAction} className="flex items-start gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="min-w-[180px] flex-1">
        <input
          name="name"
          required
          defaultValue={pick(v, "name", name)}
          aria-label="組織名"
          className="w-full rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-[13px] outline-none focus:border-[#2563eb]"
        />
      </span>
      <span className="w-[110px]">
        <input
          name="deptCode"
          defaultValue={pick(v, "deptCode", deptCode ?? "")}
          placeholder="—"
          aria-label="部署コード"
          className={INPUT}
        />
      </span>
      <span className="w-[110px]">
        <input
          name="workplaceCode"
          defaultValue={pick(v, "workplaceCode", workplaceCode ?? "")}
          placeholder="—"
          aria-label="職場コード"
          className={INPUT}
        />
      </span>
      <SaveButton />
      {(state.error || state.message) && (
        <span className={`text-xs ${state.error ? "text-[#b91c1c]" : "text-[#1c7a4d]"}`}>
          {state.error ?? "保存"}
        </span>
      )}
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
    >
      <Save className="h-3.5 w-3.5" />
      保存
    </button>
  );
}

function DeleteButton({ confirmText, label }: { confirmText: string; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-[#b91c1c] hover:underline disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/**
 * 1行ぶんの削除。所属者がいる組織はサーバー側で拒否される。
 *
 * 配下の組織があるときは、そのまま消すと配下が黙って最上位に浮き上がるので、
 * 「配下を上へ移して削除」だけを出す。同じ名前の枠が二重にできてしまったときに、
 * 中身（配下）を残したまま片方を畳めるようにするため。
 */
export function OrgCodeDeleteForm({
  id,
  name,
  childCount,
  parentName,
}: {
  id: string;
  name: string;
  childCount: number;
  parentName: string | null;
}) {
  const [state, formAction] = useActionState(deleteOrgUnitAction, {} as OrgActionState);
  const hasKids = childCount > 0;
  const dest = parentName ?? "最上位";
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      {hasKids && <input type="hidden" name="moveChildren" value="1" />}
      <DeleteButton
        label={hasKids ? "配下を上へ移して削除" : "削除"}
        confirmText={
          hasKids
            ? `「${name}」を削除し、配下の ${childCount} 件を「${dest}」へ移します。よろしいですか？`
            : `「${name}」を削除します。よろしいですか？`
        }
      />
      {state.error && <p className="mt-1 text-xs text-[#b91c1c]">{state.error}</p>}
    </form>
  );
}

/**
 * 部署・職場の追加。
 *
 * 「部署」を選ぶと本部直下に、「職場」を選ぶと選んだ部署の下に作る。
 * 組織コードは職場コード（無ければ部署コード）をそのまま使う
 * ＝ 人事システムのコードとアプリのコードを一致させておくため。
 */
export function OrgCodeCreateForm({ parentOptions }: { parentOptions: OrgParentOption[] }) {
  const [state, formAction] = useActionState(createOrgUnitAction, {} as OrgActionState);
  const v = state.values;
  const kind = pick(v, "kind", "workplace");

  return (
    <form action={formAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">部署・職場を追加</h2>
      <p className="mb-4 text-xs text-[#707070]">
        人事システムのコードをそのまま入れてください。ここで作った組織は、組織図とポータル連携に
        すぐ反映されます（ポータルへは「設定 → ポータルへ連携」で送られます）。
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className="mb-1 block text-xs font-medium text-[#707070]">
            区分 *
          </label>
          <select id="kind" name="kind" defaultValue={kind} className={INPUT_L}>
            <option value="workplace">職場（部署の下）</option>
            <option value="dept">部署（本部の直下）</option>
            <option value="factory">工場（本部の直下）</option>
          </select>
        </div>
        <div>
          <label htmlFor="new-name" className="mb-1 block text-xs font-medium text-[#707070]">
            名称 *
          </label>
          <input id="new-name" name="name" required defaultValue={pick(v, "name", "")} className={INPUT_L} />
        </div>
        <div>
          <label htmlFor="new-dept" className="mb-1 block text-xs font-medium text-[#707070]">
            部署コード
          </label>
          <input
            id="new-dept"
            name="deptCode"
            defaultValue={pick(v, "deptCode", "")}
            placeholder="12121102"
            className={`${INPUT_L} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="new-wp" className="mb-1 block text-xs font-medium text-[#707070]">
            職場コード
          </label>
          <input
            id="new-wp"
            name="workplaceCode"
            defaultValue={pick(v, "workplaceCode", "")}
            placeholder="12124001"
            className={`${INPUT_L} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="new-code" className="mb-1 block text-xs font-medium text-[#707070]">
            組織コード *
          </label>
          <input
            id="new-code"
            name="code"
            required
            defaultValue={pick(v, "code", "")}
            placeholder="職場コードと同じ値で構いません"
            className={`${INPUT_L} font-mono`}
          />
          <p className="mt-1 text-[11px] text-[#909090]">アプリ内で組織を識別する値。重複できません。</p>
        </div>
        <div>
          <label htmlFor="new-parent" className="mb-1 block text-xs font-medium text-[#707070]">
            上位組織
          </label>
          <select id="new-parent" name="parentId" defaultValue={pick(v, "parentId", "")} className={INPUT_L}>
            <option value="">（最上位）</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {"　".repeat(o.depth)}
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-[#909090]">職場のときは、所属する工場・部を選んでください。</p>
        </div>
      </div>

      {state.error && (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}

      <div className="mt-4">
        <AddButton />
      </div>
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
    >
      <Plus className="h-4 w-4" />
      追加する
    </button>
  );
}

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import SubmitButton from "./SubmitButton";
import type { TransferActionState } from "@/app/transfers/actions";
import { pick } from "@/lib/formState";
import {
  TRANSFER_KIND_LABEL,
  TRANSFER_KIND_ORDER,
  type Transfer,
} from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

export interface OrgOption {
  id: string;
  label: string;
  depth: number;
}

export interface EmployeeChoice {
  id: string;
  employeeNo: string;
  name: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  positionName: string | null;
  dutyName: string | null;
  grade: string | null;
}

/**
 * 異動申請書の入力フォーム。
 *
 * 帳票の「現」欄は人事マスターの現在値をそのまま出す（対象者を選ぶと自動で埋まる）。
 * 「新」欄だけを人が入力する形にして、転記ミスが起きないようにしている。
 */
export default function TransferForm({
  action,
  transfer,
  employees,
  orgOptions,
}: {
  action: (prev: TransferActionState, form: FormData) => Promise<TransferActionState>;
  transfer?: Transfer;
  employees: EmployeeChoice[];
  orgOptions: OrgOption[];
}) {
  const [state, formAction] = useActionState(action, {} as TransferActionState);
  // React 19 はアクション完了時にフォームを自動リセットするため、
  // エラーで戻ってきたときは送信値を defaultValue に反映して入力を復元する。
  const v = state.values;
  const [employeeId, setEmployeeId] = useState(transfer?.employeeId ?? "");
  // 送信値が返ってきたら選択中の対象者もそれに合わせる（自動リセットで消えないように）。
  // React の「props 変化に合わせて state を調整する」パターン（レンダー中の setState）。
  // その後の変更は利用者の操作が優先される。
  const [seenValues, setSeenValues] = useState(v);
  if (v !== seenValues) {
    setSeenValues(v);
    if (v?.employeeId !== undefined) setEmployeeId(v.employeeId);
  }

  const selected = employees.find((e) => e.id === employeeId);

  // 編集時は保存済みの「現」を、新規時は選んだ社員の現在値を表示する
  const current = transfer
    ? {
        orgUnitName: transfer.fromOrgUnitName,
        positionName: transfer.fromPosition,
        dutyName: transfer.fromDuty,
        grade: transfer.fromGrade,
        orgUnitId: transfer.fromOrgUnitId,
      }
    : {
        orgUnitName: selected?.orgUnitName ?? null,
        positionName: selected?.positionName ?? null,
        dutyName: selected?.dutyName ?? null,
        grade: selected?.grade ?? null,
        orgUnitId: selected?.orgUnitId ?? null,
      };

  return (
    <form action={formAction} className="space-y-6">
      {transfer && <input type="hidden" name="id" value={transfer.id} />}
      {/* 「現」の値は帳票にそのまま載るので、hidden で確定させて送る */}
      <input type="hidden" name="fromOrgUnitId" value={current.orgUnitId ?? ""} />
      <input type="hidden" name="fromPosition" value={current.positionName ?? ""} />
      <input type="hidden" name="fromDuty" value={current.dutyName ?? ""} />
      <input type="hidden" name="fromGrade" value={current.grade ?? ""} />

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">申請の内容</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="employeeId" className="mb-1 block text-sm font-medium text-[#555555]">
              対象者 *
            </label>
            {/* 制御コンポーネントにすると React 19 のフォーム自動リセットで選択が消え、
                required に引っかかって再送信できなくなる。他の select と同じく
                「key で作り直す非制御 + onChange で表示用 state を同期」にしている。 */}
            <select
              id="employeeId"
              name="employeeId"
              required
              key={`emp-${v?.employeeId ?? ""}`}
              defaultValue={v?.employeeId ?? transfer?.employeeId ?? ""}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={INPUT}
            >
              <option value="">選んでください</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}（{e.employeeNo}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="kind" className="mb-1 block text-sm font-medium text-[#555555]">
              異動区分 *
            </label>
            <select
              id="kind"
              name="kind"
              key={`kind-${v?.kind ?? ""}`}
              defaultValue={v?.kind ?? transfer?.kind ?? "haichi"}
              className={INPUT}
            >
              {TRANSFER_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {TRANSFER_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="orderDate" className="mb-1 block text-sm font-medium text-[#555555]">
              発令日
            </label>
            <input
              id="orderDate"
              name="orderDate"
              type="date"
              defaultValue={pick(v, "orderDate", transfer?.orderDate)}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#909090]">辞令の日付。</p>
          </div>
          <div>
            <label htmlFor="effectiveDate" className="mb-1 block text-sm font-medium text-[#555555]">
              適用日 *
            </label>
            <input
              id="effectiveDate"
              name="effectiveDate"
              type="date"
              required
              defaultValue={pick(v, "effectiveDate", transfer?.effectiveDate)}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#909090]">新しい所属での勤務開始日。</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">異動前 → 異動後</h2>
        <p className="mb-4 text-xs text-[#707070]">
          「現」は人事マスターの現在値です。変更する項目だけ「新」に入力してください（空欄は現状維持）。
        </p>
        <div className="space-y-4">
          <CompareRow
            label="所属"
            before={<ReadOnly value={current.orgUnitName} />}
            after={
              <select
                id="toOrgUnitId"
                name="toOrgUnitId"
                key={`toOrg-${v?.toOrgUnitId ?? ""}`}
                defaultValue={pick(v, "toOrgUnitId", transfer?.toOrgUnitId)}
                className={INPUT}
              >
                <option value="">（変更なし）</option>
                {orgOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {"　".repeat(o.depth)}
                    {o.label}
                  </option>
                ))}
              </select>
            }
          />
          <CompareRow
            label="役職"
            before={<ReadOnly value={current.positionName} />}
            after={<input name="toPosition" defaultValue={pick(v, "toPosition", transfer?.toPosition)} className={INPUT} />}
          />
          <CompareRow
            label="職務"
            before={<ReadOnly value={current.dutyName} />}
            after={<input name="toDuty" defaultValue={pick(v, "toDuty", transfer?.toDuty)} className={INPUT} />}
          />
          <CompareRow
            label="等級"
            before={<ReadOnly value={current.grade} />}
            after={<input name="toGrade" defaultValue={pick(v, "toGrade", transfer?.toGrade)} className={INPUT} />}
          />
        </div>
      </section>

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">理由・備考</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="reason" className="mb-1 block text-sm font-medium text-[#555555]">
              異動理由
            </label>
            <textarea id="reason" name="reason" rows={3} defaultValue={pick(v, "reason", transfer?.reason)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="remarks" className="mb-1 block text-sm font-medium text-[#555555]">
              備考
            </label>
            <textarea id="remarks" name="remarks" rows={2} defaultValue={pick(v, "remarks", transfer?.remarks)} className={INPUT} />
          </div>
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>{transfer ? "保存する" : "申請書を作成"}</SubmitButton>
        <Link
          href={transfer ? `/transfers/${transfer.id}` : "/transfers"}
          className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          キャンセル
        </Link>
      </div>
    </form>
  );
}

function CompareRow({
  label,
  before,
  after,
}: {
  label: string;
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto_1fr] sm:items-center">
      <div className="text-sm font-medium text-[#555555]">{label}</div>
      <div>
        <div className="mb-1 text-[10px] text-[#909090] sm:hidden">現</div>
        {before}
      </div>
      <div className="hidden text-center text-[#c8c8c8] sm:block">→</div>
      <div>
        <div className="mb-1 text-[10px] text-[#909090] sm:hidden">新</div>
        {after}
      </div>
    </div>
  );
}

function ReadOnly({ value }: { value: string | null }) {
  return (
    <div className="rounded-lg border border-dashed border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-sm text-[#707070]">
      {value || "—"}
    </div>
  );
}

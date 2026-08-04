"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import SubmitButton from "./SubmitButton";
import type { ReemploymentActionState } from "@/app/reemployments/actions";
import { pick } from "@/lib/formState";
import {
  REEMPLOYMENT_DUTY_COUNT,
  REEMPLOYMENT_FIXED_TEXT,
  REEMPLOYMENT_REASON_HEADINGS,
  REEMPLOYMENT_TYPES,
  actualWorkHours,
  ageAt,
  type Reemployment,
} from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

export interface ReemploymentEmployeeChoice {
  id: string;
  employeeNo: string;
  name: string;
  orgUnitName: string | null;
  employmentType: string | null;
  birthDate: string | null;
}

/**
 * 指定帳票 **J-456「高齢者雇用・アルバイト契約満了に伴う継続雇用申請書」** の入力フォーム。
 *
 * 画面の並びは帳票の上から下（対象者情報 → 申請内容 → 理由・必要性 → コンプライアンス確認 → 結論）
 * に揃えてある。年齢と実働時間は入力させず、生年月日・勤務時間から計算して表示する
 * （帳票にも計算値が入る。人が二重に書いて食い違うのを防ぐため）。
 */
export default function ReemploymentForm({
  action,
  reemployment,
  employees,
}: {
  action: (prev: ReemploymentActionState, form: FormData) => Promise<ReemploymentActionState>;
  reemployment?: Reemployment;
  employees: ReemploymentEmployeeChoice[];
}) {
  const [state, formAction] = useActionState(action, {} as ReemploymentActionState);
  const v = state.values;

  const [employeeId, setEmployeeId] = useState(reemployment?.employeeId ?? "");
  const [contractEnd, setContractEnd] = useState(reemployment?.contractEndDate ?? "");
  const [workStart, setWorkStart] = useState(reemployment?.workStart ?? "");
  const [workEnd, setWorkEnd] = useState(reemployment?.workEnd ?? "");
  const [breakHours, setBreakHours] = useState(String(reemployment?.breakHours ?? ""));

  // 送信値が返ってきたら表示用の state も合わせる（React 19 の自動リセット対策）
  const [seenValues, setSeenValues] = useState(v);
  if (v !== seenValues) {
    setSeenValues(v);
    if (v?.employeeId !== undefined) setEmployeeId(v.employeeId);
    if (v?.contractEndDate !== undefined) setContractEnd(v.contractEndDate);
    if (v?.workStart !== undefined) setWorkStart(v.workStart);
    if (v?.workEnd !== undefined) setWorkEnd(v.workEnd);
    if (v?.breakHours !== undefined) setBreakHours(v.breakHours);
  }

  const selected = employees.find((e) => e.id === employeeId);
  const age = ageAt(selected?.birthDate ?? null, contractEnd || null);
  const actual = actualWorkHours(workStart || null, workEnd || null, Number(breakHours) || 0);

  return (
    <form action={formAction} className="space-y-6">
      {reemployment && <input type="hidden" name="id" value={reemployment.id} />}
      {/* 所属は申請時点の名称を帳票に焼き付ける */}
      <input
        type="hidden"
        name="orgUnitName"
        value={reemployment?.orgUnitName ?? selected?.orgUnitName ?? ""}
      />

      {/* ===== 対象者情報 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">対象者情報</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="employeeId" className="mb-1 block text-sm font-medium text-[#555555]">
              氏名 *
            </label>
            <select
              id="employeeId"
              name="employeeId"
              required
              key={`emp-${v?.employeeId ?? ""}`}
              defaultValue={v?.employeeId ?? reemployment?.employeeId ?? ""}
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
            <label className="mb-1 block text-sm font-medium text-[#555555]">所属</label>
            <ReadOnly value={reemployment?.orgUnitName ?? selected?.orgUnitName ?? null} />
          </div>
          <div>
            <label htmlFor="currentEmploymentType" className="mb-1 block text-sm font-medium text-[#555555]">
              現在の雇用形態
            </label>
            <input
              id="currentEmploymentType"
              name="currentEmploymentType"
              key={`cur-${v?.currentEmploymentType ?? ""}`}
              defaultValue={
                pick(v, "currentEmploymentType", reemployment?.currentEmploymentType) ||
                (reemployment ? "" : selected?.employmentType ?? "")
              }
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#909090]">未入力なら選んだ社員の雇用体系が入ります。</p>
          </div>
          <div>
            <label htmlFor="contractEndDate" className="mb-1 block text-sm font-medium text-[#555555]">
              契約満了日 *
            </label>
            <input
              id="contractEndDate"
              name="contractEndDate"
              type="date"
              required
              defaultValue={pick(v, "contractEndDate", reemployment?.contractEndDate)}
              onChange={(e) => setContractEnd(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#555555]">年齢</label>
            <ReadOnly value={age === null ? null : `${age}歳`} />
            <p className="mt-1 text-xs text-[#909090]">契約満了日時点の満年齢を生年月日から計算します。</p>
          </div>
          <div>
            <label htmlFor="formDate" className="mb-1 block text-sm font-medium text-[#555555]">
              作成日
            </label>
            <input
              id="formDate"
              name="formDate"
              type="date"
              defaultValue={pick(v, "formDate", reemployment?.formDate)}
              className={INPUT}
            />
          </div>
        </div>
      </section>

      {/* ===== 申請内容 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">申請内容</h2>
        <p className="mb-4 text-xs text-[#707070]">{REEMPLOYMENT_FIXED_TEXT.lead}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="employmentType" className="mb-1 block text-sm font-medium text-[#555555]">
              雇用形態
            </label>
            <select
              id="employmentType"
              name="employmentType"
              key={`type-${v?.employmentType ?? ""}`}
              defaultValue={pick(v, "employmentType", reemployment?.employmentType)}
              className={INPUT}
            >
              <option value="">選んでください</option>
              {REEMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="workPlace" className="mb-1 block text-sm font-medium text-[#555555]">
              勤務地
            </label>
            <input
              id="workPlace"
              name="workPlace"
              defaultValue={pick(v, "workPlace", reemployment?.workPlace)}
              className={INPUT}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="periodFrom" className="mb-1 block text-sm font-medium text-[#555555]">
              契約期間 *
            </label>
            <div className="flex items-center gap-2">
              <input
                id="periodFrom"
                name="periodFrom"
                type="date"
                required
                defaultValue={pick(v, "periodFrom", reemployment?.periodFrom)}
                className={INPUT}
              />
              <span className="text-sm text-[#909090]">～</span>
              <input
                name="periodTo"
                type="date"
                required
                defaultValue={pick(v, "periodTo", reemployment?.periodTo)}
                className={INPUT}
              />
            </div>
          </div>
          <div>
            <label htmlFor="daysPerWeek" className="mb-1 block text-sm font-medium text-[#555555]">
              勤務日数（週）
            </label>
            <input
              id="daysPerWeek"
              name="daysPerWeek"
              type="number"
              min={1}
              max={7}
              step={0.5}
              defaultValue={pick(
                v,
                "daysPerWeek",
                reemployment?.daysPerWeek === null || reemployment?.daysPerWeek === undefined
                  ? null
                  : String(reemployment.daysPerWeek),
              )}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="breakHours" className="mb-1 block text-sm font-medium text-[#555555]">
              休憩（時間）
            </label>
            <input
              id="breakHours"
              name="breakHours"
              type="number"
              min={0}
              max={8}
              step={0.25}
              defaultValue={pick(
                v,
                "breakHours",
                reemployment?.breakHours === null || reemployment?.breakHours === undefined
                  ? null
                  : String(reemployment.breakHours),
              )}
              onChange={(e) => setBreakHours(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="workStart" className="mb-1 block text-sm font-medium text-[#555555]">
              勤務時間
            </label>
            <div className="flex items-center gap-2">
              <input
                id="workStart"
                name="workStart"
                type="time"
                defaultValue={pick(v, "workStart", reemployment?.workStart)}
                onChange={(e) => setWorkStart(e.target.value)}
                className={INPUT}
              />
              <span className="text-sm text-[#909090]">～</span>
              <input
                name="workEnd"
                type="time"
                defaultValue={pick(v, "workEnd", reemployment?.workEnd)}
                onChange={(e) => setWorkEnd(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#555555]">実働</label>
            <ReadOnly value={actual === null ? null : `${actual}時間`} />
            <p className="mt-1 text-xs text-[#909090]">勤務時間と休憩から計算します。</p>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-[#555555]">業務内容 *</p>
          <div className="space-y-2">
            {Array.from({ length: REEMPLOYMENT_DUTY_COUNT }, (_, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="pt-2 text-sm text-[#909090]">{["①", "②", "③"][i]}</span>
                <textarea
                  name={`duty${i}`}
                  rows={1}
                  defaultValue={pick(v, `duty${i}`, reemployment?.duties[i])}
                  className={INPUT}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 継続雇用の理由・必要性 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">継続雇用の理由・必要性 *</h2>
        <p className="mb-4 text-xs text-[#707070]">見出し①〜④は帳票に固定で印字されます。</p>
        <div className="space-y-4">
          {REEMPLOYMENT_REASON_HEADINGS.map((heading, i) => (
            <div key={heading}>
              <label htmlFor={`reason${i}`} className="mb-1 block text-sm font-medium text-[#555555]">
                {["①", "②", "③", "④"][i]} {heading}
              </label>
              <textarea
                id={`reason${i}`}
                name={`reason${i}`}
                rows={2}
                defaultValue={pick(v, `reason${i}`, reemployment?.reasons[i])}
                className={INPUT}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ===== コンプライアンス確認・結論 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">コンプライアンス確認・結論</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="compliance" className="mb-1 block text-sm font-medium text-[#555555]">
              コンプライアンス確認
            </label>
            <textarea
              id="compliance"
              name="compliance"
              rows={2}
              defaultValue={pick(
                v,
                "compliance",
                reemployment?.compliance ?? REEMPLOYMENT_FIXED_TEXT.compliance,
              )}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="conclusion" className="mb-1 block text-sm font-medium text-[#555555]">
              結論
            </label>
            <textarea
              id="conclusion"
              name="conclusion"
              rows={2}
              defaultValue={pick(
                v,
                "conclusion",
                reemployment?.conclusion ?? REEMPLOYMENT_FIXED_TEXT.conclusion2,
              )}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#909090]">
              帳票では「{REEMPLOYMENT_FIXED_TEXT.conclusion1}」の次の行に入ります。
            </p>
          </div>
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>{reemployment ? "保存する" : "申請書を作成"}</SubmitButton>
        <Link
          href={reemployment ? `/reemployments/${reemployment.id}` : "/reemployments"}
          className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          キャンセル
        </Link>
      </div>
    </form>
  );
}

function ReadOnly({ value }: { value: string | null }) {
  return (
    <div className="rounded-lg border border-dashed border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-sm text-[#707070]">
      {value || "—"}
    </div>
  );
}

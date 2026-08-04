"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import SubmitButton from "./SubmitButton";
import type { TransferActionState } from "@/app/transfers/actions";
import { pick, pickMulti } from "@/lib/formState";
import { TRANSFER_FORM, singleReasonLabel } from "@/lib/transferForm";
import {
  ASSIGNMENT_KINDS,
  COMPANY_CAR_AFTER_KINDS,
  DEPT_AGREEMENTS,
  HOUSING_KINDS,
  MOBILE_AFTER_KINDS,
  PARKING_KINDS,
  SINGLE_ASSIGNMENT_REASONS,
  TRANSFER_FORM_KIND_LABEL,
  TRANSFER_KIND_LABEL,
  TRANSFER_KIND_ORDER,
  YES_NO,
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
 * 指定帳票 **J-426(9)「異動申請書 ・ 組織名称追加変更申請書」** の入力フォーム。
 *
 * 画面の並びは帳票の上から下へ揃えてある。印刷したときに「どこに入るのか」が
 * 見ただけで分かるようにするため。
 *
 * 帳票の「現」欄は人事マスターの現在値をそのまま出す（対象者を選ぶと自動で埋まる）。
 * 「新」欄だけを人が入力する形にして、転記ミスが起きないようにしている。
 *
 * チェック欄は**あえて必須にしていない**。実物は手書きでㇾ点を入れる欄であり、
 * 空欄のまま印刷して手で書き込む運用も残せるようにするため。
 * ただし「転居なしなのに住居が埋まっている」といった矛盾は出せないようにしてある
 * （親の選択が「あり」でないと子の欄を出さない・送っても保存側で落とす）。
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
  // 帳票の連動（親のチェックで子の欄を出す）に必要なぶんだけ state で持つ
  const [formKind, setFormKind] = useState(transfer?.formKind ?? "transfer");
  const [relocation, setRelocation] = useState(transfer?.relocation ?? "");
  const [mobile, setMobile] = useState(transfer?.mobile ?? "");
  const [companyCar, setCompanyCar] = useState(transfer?.companyCar ?? "");
  const [companyCarAfter, setCompanyCarAfter] = useState(transfer?.companyCarAfter ?? "");
  const [assignmentAfter, setAssignmentAfter] = useState(transfer?.assignmentAfter ?? "");

  // 送信値が返ってきたら連動用の state もそれに合わせる（自動リセットで消えないように）。
  // React の「props 変化に合わせて state を調整する」パターン（レンダー中の setState）。
  // その後の変更は利用者の操作が優先される。
  const [seenValues, setSeenValues] = useState(v);
  if (v !== seenValues) {
    setSeenValues(v);
    if (v?.employeeId !== undefined) setEmployeeId(v.employeeId);
    if (v?.formKind !== undefined) setFormKind(v.formKind === "org_rename" ? "org_rename" : "transfer");
    if (v?.relocation !== undefined) setRelocation(v.relocation);
    if (v?.mobile !== undefined) setMobile(v.mobile);
    if (v?.companyCar !== undefined) setCompanyCar(v.companyCar);
    if (v?.companyCarAfter !== undefined) setCompanyCarAfter(v.companyCarAfter);
    if (v?.assignmentAfter !== undefined) setAssignmentAfter(v.assignmentAfter);
  }

  const selected = employees.find((e) => e.id === employeeId);
  const isRename = formKind === "org_rename";

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

      {/* ===== 帳票の種類 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">この申請書の用途</h2>
        <p className="mb-4 text-xs text-[#707070]">
          帳票 {TRANSFER_FORM.formNo} は人事異動と組織名称の追加変更を1枚で兼ねています。
        </p>
        {/*
          送信値は state から hidden で送る。
          ラジオを name つきの制御コンポーネントにすると、React 19 がアクション後に
          フォームを自動リセットしたときに DOM だけが既定値へ戻り、画面（state 由来）は
          組織名称のままなのに送信値は異動申請、という食い違いが起きる。
          「表示と送信値を必ず一致させる」ため、入力は state だけを動かす役にしてある。
        */}
        <input type="hidden" name="formKind" value={formKind} />
        <div className="flex flex-wrap gap-3">
          {(["transfer", "org_rename"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFormKind(k)}
              aria-pressed={formKind === k}
              className={`cursor-pointer rounded-lg border px-4 py-2 text-sm ${
                formKind === k
                  ? "border-[#2563eb] bg-[#eff6ff] font-medium text-[#1d4ed8]"
                  : "border-[#e5e5e5] bg-white text-[#555555]"
              }`}
            >
              {TRANSFER_FORM_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      {/* ===== 【対象社員】 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-4 text-sm font-bold text-[#333333]">【対象社員】</h2>
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
            <p className="mt-1 text-xs text-[#909090]">
              部署・社員ｺｰﾄﾞ・氏名は選んだ社員から帳票に転記されます。
            </p>
          </div>
          <div>
            <label htmlFor="formDate" className="mb-1 block text-sm font-medium text-[#555555]">
              作成日
            </label>
            <input
              id="formDate"
              name="formDate"
              type="date"
              defaultValue={pick(v, "formDate", transfer?.formDate)}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#909090]">帳票の右上に入ります。</p>
          </div>
        </div>
      </section>

      {!isRename && (
        <>
          {/* ===== 【異動日付】 ===== */}
          <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-4 text-sm font-bold text-[#333333]">【異動日付】</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="effectiveDate" className="mb-1 block text-sm font-medium text-[#555555]">
                  異動日付 *
                </label>
                <input
                  id="effectiveDate"
                  name="effectiveDate"
                  type="date"
                  required
                  defaultValue={pick(v, "effectiveDate", transfer?.effectiveDate)}
                  className={INPUT}
                />
                <p className="mt-1 text-xs text-[#909090]">新しい所属での勤務開始日。発令の反映日になります。</p>
              </div>
              <div>
                <label htmlFor="arrivalDate" className="mb-1 block text-sm font-medium text-[#555555]">
                  異動先赴任日
                </label>
                <input
                  id="arrivalDate"
                  name="arrivalDate"
                  type="date"
                  defaultValue={pick(v, "arrivalDate", transfer?.arrivalDate)}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="limitedFrom" className="mb-1 block text-sm font-medium text-[#555555]">
                  ※期間限定の場合
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="limitedFrom"
                    name="limitedFrom"
                    type="date"
                    defaultValue={pick(v, "limitedFrom", transfer?.limitedFrom)}
                    className={INPUT}
                  />
                  <span className="text-sm text-[#909090]">～</span>
                  <input
                    name="limitedTo"
                    type="date"
                    defaultValue={pick(v, "limitedTo", transfer?.limitedTo)}
                    className={INPUT}
                  />
                </div>
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
                <p className="mt-1 text-xs text-[#909090]">辞令の日付（アプリ内の管理用）。</p>
              </div>
            </div>
          </section>

          {/* ===== 【異動部署】 ===== */}
          <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-1 text-sm font-bold text-[#333333]">【異動部署】</h2>
            <p className="mb-4 text-xs text-[#707070]">
              「現」は人事マスターの現在値です。変更する項目だけ「新」に入力してください（空欄は現状維持）。
              {TRANSFER_FORM.dutyNote}
            </p>
            <div className="space-y-4">
              <CompareRow
                label="部署"
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
                label="職務"
                before={<ReadOnly value={current.dutyName} />}
                after={<input name="toDuty" defaultValue={pick(v, "toDuty", transfer?.toDuty)} className={INPUT} />}
              />
              <CompareRow
                label="役職"
                before={<ReadOnly value={current.positionName} />}
                after={
                  <input name="toPosition" defaultValue={pick(v, "toPosition", transfer?.toPosition)} className={INPUT} />
                }
              />
              <CompareRow
                label="等級"
                before={<ReadOnly value={current.grade} />}
                after={<input name="toGrade" defaultValue={pick(v, "toGrade", transfer?.toGrade)} className={INPUT} />}
              />
            </div>
            <p className="mt-3 text-xs text-[#909090]">
              役職・等級は帳票 {TRANSFER_FORM.formNo} には印字されませんが、発令時に人事マスターへ反映されます。
            </p>
          </section>

          {/* ===== 【異動事由】【部門長間の合意】 ===== */}
          <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-4 text-sm font-bold text-[#333333]">【異動事由】</h2>
            <textarea
              id="reason"
              name="reason"
              rows={3}
              defaultValue={pick(v, "reason", transfer?.reason)}
              className={INPUT}
            />
            <p className="mt-1 text-xs text-[#909090]">帳票では3行の記入欄です。改行はそのまま印刷されます。</p>

            <div className="mt-5">
              <RadioRow
                label="【部門長間の合意】"
                note={TRANSFER_FORM.deptAgreementNote}
                name="deptAgreement"
                options={DEPT_AGREEMENTS}
                defaultValue={pick(v, "deptAgreement", transfer?.deptAgreement)}
              />
            </div>
          </section>

        </>
      )}

      {/* ===== 【組織名称】 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">【組織名称】</h2>
        <p className="mb-4 text-xs text-[#707070]">
          {isRename
            ? "組織名称の追加・変更を申請します。"
            : "異動に伴って組織名称も変える場合だけ記入してください。"}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="orgNameBefore" className="mb-1 block text-sm font-medium text-[#555555]">
              変更前
            </label>
            <input
              id="orgNameBefore"
              name="orgNameBefore"
              defaultValue={pick(v, "orgNameBefore", transfer?.orgNameBefore)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="orgNameAfter" className="mb-1 block text-sm font-medium text-[#555555]">
              追加・変更後 {isRename ? "*" : ""}
            </label>
            <input
              id="orgNameAfter"
              name="orgNameAfter"
              defaultValue={pick(v, "orgNameAfter", transfer?.orgNameAfter)}
              className={INPUT}
            />
          </div>
        </div>
      </section>

      {!isRename && (
        <>
          {/* ===== 該当にㇾ点（チェック欄） ===== */}
          <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-1 text-sm font-bold text-[#333333]">{TRANSFER_FORM.checkNote}</h2>
            <p className="mb-4 text-xs text-[#707070]">
              未選択のまま印刷して、用紙に手書きでㇾ点を入れることもできます。
            </p>

            <div className="space-y-5">
              <RadioRow
                label="【転居】"
                name="relocation"
                options={YES_NO}
                defaultValue={pick(v, "relocation", transfer?.relocation)}
                onChange={setRelocation}
              />

              {relocation === "あり" && (
                <div className="grid gap-4 rounded-lg bg-[#fafafa] p-4 sm:grid-cols-2">
                  <RadioRow
                    label="【異動前 住居】"
                    name="housingBefore"
                    options={HOUSING_KINDS}
                    defaultValue={pick(v, "housingBefore", transfer?.housingBefore)}
                    stacked
                  />
                  <RadioRow
                    label="【異動後 住居】"
                    name="housingAfter"
                    options={HOUSING_KINDS}
                    defaultValue={pick(v, "housingAfter", transfer?.housingAfter)}
                    stacked
                  />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <RadioRow
                  label="【異動前 赴任形態】"
                  name="assignmentBefore"
                  options={ASSIGNMENT_KINDS}
                  defaultValue={pick(v, "assignmentBefore", transfer?.assignmentBefore)}
                  stacked
                />
                <RadioRow
                  label="【異動後 赴任形態】"
                  name="assignmentAfter"
                  options={ASSIGNMENT_KINDS}
                  defaultValue={pick(v, "assignmentAfter", transfer?.assignmentAfter)}
                  onChange={setAssignmentAfter}
                  stacked
                />
              </div>

              {assignmentAfter === "単身赴任" && (
                <fieldset className="rounded-lg bg-[#fafafa] p-4">
                  <legend className="px-1 text-sm font-medium text-[#555555]">
                    &lt;単身赴任 事由&gt;（複数チェック可）
                  </legend>
                  <div className="mt-2 space-y-2">
                    {SINGLE_ASSIGNMENT_REASONS.map((_, i) => (
                      <label key={i} className="flex items-start gap-2 text-sm text-[#333333]">
                        <input
                          type="checkbox"
                          name="singleReasons"
                          value={i}
                          defaultChecked={pickMulti(v, "singleReasons", transfer?.singleReasons ?? []).includes(i)}
                          className="mt-0.5"
                        />
                        {singleReasonLabel(i)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <RadioRow
                label="【携帯】"
                name="mobile"
                options={YES_NO}
                defaultValue={pick(v, "mobile", transfer?.mobile)}
                onChange={setMobile}
              />

              {mobile === "あり" && (
                <div className="rounded-lg bg-[#fafafa] p-4">
                  <RadioRow
                    label="【異動後】"
                    name="mobileAfter"
                    options={MOBILE_AFTER_KINDS}
                    defaultValue={pick(v, "mobileAfter", transfer?.mobileAfter)}
                    stacked
                  />
                </div>
              )}

              <RadioRow
                label="【社用車】"
                name="companyCar"
                options={YES_NO}
                defaultValue={pick(v, "companyCar", transfer?.companyCar)}
                onChange={setCompanyCar}
              />

              {companyCar === "あり" && (
                <div className="space-y-4 rounded-lg bg-[#fafafa] p-4">
                  <RadioRow
                    label="【異動後】"
                    name="companyCarAfter"
                    options={COMPANY_CAR_AFTER_KINDS}
                    defaultValue={pick(v, "companyCarAfter", transfer?.companyCarAfter)}
                    onChange={setCompanyCarAfter}
                    stacked
                  />
                  {companyCarAfter === "その他" && (
                    <div>
                      <label htmlFor="companyCarOther" className="mb-1 block text-sm font-medium text-[#555555]">
                        その他の内容
                      </label>
                      <input
                        id="companyCarOther"
                        name="companyCarOther"
                        defaultValue={pick(v, "companyCarOther", transfer?.companyCarOther)}
                        className={INPUT}
                      />
                    </div>
                  )}
                  <RadioRow
                    label="【社用車駐車場】"
                    name="parking"
                    options={PARKING_KINDS}
                    defaultValue={pick(v, "parking", transfer?.parking)}
                  />
                </div>
              )}

              <RadioRow
                label="【通勤経路変更】"
                name="commuteChange"
                options={YES_NO}
                defaultValue={pick(v, "commuteChange", transfer?.commuteChange)}
              />
            </div>
          </section>

          {/* ===== 確認欄 ===== */}
          <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-4 text-sm font-bold text-[#333333]">確認</h2>
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-[#333333]">
                <input
                  type="checkbox"
                  name="explainedAgreed"
                  defaultChecked={
                    v ? v.explainedAgreed !== undefined : Boolean(transfer?.explainedAgreed)
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">【本人への説明・合意】</span>
                  <br />
                  上長は異動者本人へ職務分掌・権限規程(KS-0010)に記載された職務の内容を伝え、説明を行い、合意を得た。
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-[#333333]">
                <input
                  type="checkbox"
                  name="successorChecked"
                  defaultChecked={
                    v ? v.successorChecked !== undefined : Boolean(transfer?.successorChecked)
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">【後任の確認】</span>
                  <br />
                  異動にあたり、後任が必要かを確認した。
                </span>
              </label>
            </div>
          </section>

          {/* ===== 情報ｼｽﾃﾑ部記入欄 ===== */}
          <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
            <h2 className="mb-1 text-sm font-bold text-[#333333]">情報ｼｽﾃﾑ部記入欄</h2>
            <p className="mb-4 text-xs text-[#707070]">
              決裁後に情報ｼｽﾃﾑ部が記入する欄です。分かっていれば先に入れておけます。
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="systemDeptCode" className="mb-1 block text-sm font-medium text-[#555555]">
                  部門コード（8桁）
                </label>
                <input
                  id="systemDeptCode"
                  name="systemDeptCode"
                  inputMode="numeric"
                  maxLength={8}
                  defaultValue={pick(v, "systemDeptCode", transfer?.systemDeptCode)}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="systemDeptName" className="mb-1 block text-sm font-medium text-[#555555]">
                  名称
                </label>
                <input
                  id="systemDeptName"
                  name="systemDeptName"
                  defaultValue={pick(v, "systemDeptName", transfer?.systemDeptName)}
                  className={INPUT}
                />
              </div>
            </div>
          </section>
        </>
      )}

      {/* 区分・備考はアプリ内の管理用（帳票には印字しない） */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">アプリ内の管理項目</h2>
        <p className="mb-4 text-xs text-[#707070]">
          帳票には印字されません。一覧での絞り込みや履歴の整理に使います。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="kind" className="mb-1 block text-sm font-medium text-[#555555]">
              異動区分
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
            <label htmlFor="remarks" className="mb-1 block text-sm font-medium text-[#555555]">
              備考
            </label>
            <textarea
              id="remarks"
              name="remarks"
              rows={2}
              defaultValue={pick(v, "remarks", transfer?.remarks)}
              className={INPUT}
            />
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

/**
 * 帳票のチェック欄1つぶん。
 *
 * 未選択を必ず選べるように「（未選択）」を先頭に置く。radio は一度入れると
 * 外せないので、これが無いと「間違えて押したら消せない」入力になってしまう。
 * 非制御（defaultChecked）+ key で React 19 の自動リセットに耐える。
 */
function RadioRow({
  label,
  note,
  name,
  options,
  defaultValue,
  onChange,
  stacked,
}: {
  label: string;
  note?: string;
  name: string;
  options: readonly string[];
  defaultValue: string;
  onChange?: (v: string) => void;
  stacked?: boolean;
}) {
  return (
    <fieldset key={`${name}-${defaultValue}`}>
      <legend className="text-sm font-medium text-[#555555]">
        {label}
        {note && <span className="ml-1 text-xs font-normal text-[#909090]">{note}</span>}
      </legend>
      <div className={`mt-2 gap-x-5 gap-y-2 ${stacked ? "flex flex-col" : "flex flex-wrap"}`}>
        <label className="flex items-center gap-1.5 text-sm text-[#909090]">
          <input
            type="radio"
            name={name}
            value=""
            defaultChecked={defaultValue === ""}
            onChange={() => onChange?.("")}
          />
          （未選択）
        </label>
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-sm text-[#333333]">
            <input
              type="radio"
              name={name}
              value={o}
              defaultChecked={defaultValue === o}
              onChange={() => onChange?.(o)}
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
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

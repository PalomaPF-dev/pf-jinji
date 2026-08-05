"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Plus, Trash2, Users } from "lucide-react";
import SubmitButton from "./SubmitButton";
import { importAppendixAction, type TransferActionState } from "@/app/transfers/actions";
import { buildTargetPicker, type EmployeeChoice, type OrgOption } from "./TransferForm";
import { TRANSFER_REASON_SUGGESTIONS } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

interface RowState {
  employeeId: string;
  toOrgUnitId: string;
  effectiveDate: string;
  reason: string;
}

/**
 * 一括異動申請（別紙）の作成フォーム。
 *
 * 「工場 → 職場 → 対象者」と絞って人を追加し、一覧（＝別紙）を作る。
 * 申請書1枚に別紙としてぶら下がり、承認・発令のながれは単独の申請と同じ。
 * 行の内容はすべて state に持ち、JSON にして1つの hidden で送る
 * （行数が動くフォームを name の配列で送ると、React 19 の自動リセットで崩れるため）。
 */
export default function BulkTransferForm({
  action,
  employees,
  orgOptions,
}: {
  action: (prev: TransferActionState, form: FormData) => Promise<TransferActionState>;
  employees: EmployeeChoice[];
  orgOptions: OrgOption[];
}) {
  const [state, formAction] = useActionState(action, {} as TransferActionState);
  const [importState, importFormAction] = useActionState(
    importAppendixAction,
    {} as TransferActionState,
  );

  const [formDate, setFormDate] = useState("");
  const [commonDate, setCommonDate] = useState("");
  const [commonReason, setCommonReason] = useState("");
  const [rows, setRows] = useState<RowState[]>([]);

  // Excelから読み込めた行を、そのまま別紙の行にする（同じ人は上書きしない）。
  // レンダー中に「props（アクション結果）の変化へ state を合わせる」パターン。
  const [seenImport, setSeenImport] = useState(importState.appendix);
  if (importState.appendix !== seenImport) {
    setSeenImport(importState.appendix);
    const add = (importState.appendix?.rows ?? []).filter((r) => !r.problem && r.employeeId);
    if (add.length > 0) {
      setRows((prev) => {
        const has = new Set(prev.map((r) => r.employeeId));
        return [
          ...prev,
          ...add
            .filter((r) => !has.has(r.employeeId!))
            .map((r) => ({
              employeeId: r.employeeId!,
              toOrgUnitId: r.toOrgUnitId ?? "",
              effectiveDate: r.effectiveDate,
              reason: r.reason,
            })),
        ];
      });
    }
  }

  // 追加用の絞り込み
  const picker = buildTargetPicker(employees);
  const [factoryId, setFactoryId] = useState(picker.factories.length === 1 ? picker.factories[0].id : "");
  const [workplaceId, setWorkplaceId] = useState("");
  const [candidateId, setCandidateId] = useState("");

  const byId = new Map(employees.map((e) => [e.id, e]));
  const candidates = employees
    .filter((e) => !factoryId || (e.factoryId ?? "") === factoryId)
    .filter((e) => !workplaceId || (e.orgUnitId ?? "") === workplaceId)
    .filter((e) => !rows.some((r) => r.employeeId === e.id));

  const addRow = (employeeId: string) => {
    if (!employeeId || rows.some((r) => r.employeeId === employeeId)) return;
    setRows((prev) => [
      ...prev,
      { employeeId, toOrgUnitId: "", effectiveDate: commonDate, reason: commonReason },
    ]);
    setCandidateId("");
  };

  const addWorkplace = () => {
    const add = candidates.filter((e) => (e.orgUnitId ?? "") === workplaceId);
    if (!workplaceId || add.length === 0) return;
    setRows((prev) => [
      ...prev,
      ...add.map((e) => ({
        employeeId: e.id,
        toOrgUnitId: "",
        effectiveDate: commonDate,
        reason: commonReason,
      })),
    ]);
  };

  const patchRow = (i: number, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-6">
      {/* ===== Excelからの一括取込 =====
          申請のフォームとは別のフォームにしてある（HTMLはフォームを入れ子にできない）。 */}
      <form action={importFormAction} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-[#333333]">
          <FileSpreadsheet className="h-4 w-4" />
          Excelから一括で読み込む
        </h2>
        <p className="mb-4 text-xs text-[#707070]">
          別紙の一覧表（個人コード・新所属組織コード・異動日・理由）をそのまま読み込めます。
          出力した別紙のExcelも読み戻せます。読み込んだ行は下の別紙に追加され、
          <strong>この時点では申請しません</strong>（内容を確かめてから申請してください）。
        </p>
        <input type="hidden" name="effectiveDate" value={commonDate} />
        <div className="flex flex-wrap items-end gap-3">
          <input
            name="appendixFile"
            type="file"
            accept=".xlsx"
            required
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[#f0f0f0] file:px-3 file:py-1.5 file:text-xs"
          />
          <input
            name="appendixSheet"
            placeholder="シート名（任意）"
            className="w-[180px] rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
          <SubmitButton variant="secondary">読み込む</SubmitButton>
        </div>
        {importState.error && (
          <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{importState.error}</p>
        )}
        {importState.message && (
          <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{importState.message}</p>
        )}
        {importState.appendix && importState.appendix.problems > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-[#f0d9d9]">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-[#f0d9d9] bg-[#fdf6f6] text-left text-[#b91c1c]">
                  <th className="px-3 py-1.5 font-medium">行</th>
                  <th className="px-3 py-1.5 font-medium">社員番号</th>
                  <th className="px-3 py-1.5 font-medium">氏名</th>
                  <th className="px-3 py-1.5 font-medium">取り込めなかった理由</th>
                </tr>
              </thead>
              <tbody>
                {importState.appendix.rows
                  .filter((r) => r.problem)
                  .map((r) => (
                    <tr key={r.rowNo} className="border-b border-[#f7f0f0] last:border-0">
                      <td className="px-3 py-1.5 text-[#707070]">{r.rowNo}</td>
                      <td className="px-3 py-1.5 font-mono text-[#707070]">{r.employeeNo}</td>
                      <td className="px-3 py-1.5 text-[#555555]">{r.employeeName || "—"}</td>
                      <td className="px-3 py-1.5 text-[#555555]">{r.problem}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </form>

    <form action={formAction} className="space-y-6">
      {/* 行の実体はJSONで送る */}
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <input type="hidden" name="formDate" value={formDate} />
      <input type="hidden" name="effectiveDate" value={commonDate} />
      <input type="hidden" name="reason" value={commonReason} />

      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">共通の内容</h2>
        <p className="mb-4 text-xs text-[#707070]">
          異動日と理由は行を追加したときの既定になります。行ごとに個別に変えられます。
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="bulkEffectiveDate" className="mb-1 block text-sm font-medium text-[#555555]">
              異動日（共通） *
            </label>
            <input
              id="bulkEffectiveDate"
              type="date"
              value={commonDate}
              onChange={(e) => setCommonDate(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="bulkReason" className="mb-1 block text-sm font-medium text-[#555555]">
              理由（共通）
            </label>
            <input
              id="bulkReason"
              list="reasonSuggestions"
              value={commonReason}
              onChange={(e) => setCommonReason(e.target.value)}
              placeholder="負荷変動の為 など"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="bulkFormDate" className="mb-1 block text-sm font-medium text-[#555555]">
              作成日
            </label>
            <input
              id="bulkFormDate"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
        <datalist id="reasonSuggestions">
          {TRANSFER_REASON_SUGGESTIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </section>

      {/* ===== 対象者の追加 ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">対象者を追加</h2>
        <p className="mb-4 text-xs text-[#707070]">自分の工場・職場から順に絞って追加します。</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="bulkFactory" className="mb-1 block text-sm font-medium text-[#555555]">
              工場（部）
            </label>
            <select
              id="bulkFactory"
              value={factoryId}
              onChange={(e) => {
                setFactoryId(e.target.value);
                setWorkplaceId("");
                setCandidateId("");
              }}
              className={INPUT}
            >
              <option value="">すべて</option>
              {picker.factories.map((f) => (
                <option key={f.id || "none"} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bulkWorkplace" className="mb-1 block text-sm font-medium text-[#555555]">
              職場
            </label>
            <select
              id="bulkWorkplace"
              value={workplaceId}
              onChange={(e) => {
                setWorkplaceId(e.target.value);
                setCandidateId("");
              }}
              className={INPUT}
              disabled={!factoryId}
            >
              <option value="">{factoryId ? "すべて" : "先に工場を選んでください"}</option>
              {factoryId &&
                picker.workplacesOf(factoryId).map((w) => (
                  <option key={w.id || "none"} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="bulkCandidate" className="mb-1 block text-sm font-medium text-[#555555]">
              対象者
            </label>
            <div className="flex gap-2">
              <select
                id="bulkCandidate"
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
                className={INPUT}
              >
                <option value="">選んでください</option>
                {candidates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}（{e.employeeNo}）
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addRow(candidateId)}
                disabled={!candidateId}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                追加
              </button>
            </div>
          </div>
        </div>
        {workplaceId && candidates.some((e) => (e.orgUnitId ?? "") === workplaceId) && (
          <button
            type="button"
            onClick={addWorkplace}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <Users className="h-4 w-4" />
            この職場の全員を追加（{candidates.filter((e) => (e.orgUnitId ?? "") === workplaceId).length}名）
          </button>
        )}
      </section>

      {/* ===== 別紙（一覧） ===== */}
      <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">別紙（異動者一覧） {rows.length}名</h2>
        <p className="mb-4 text-xs text-[#707070]">
          申請書には「別紙参照」と載り、この一覧が別紙になります。承認後の発令で全員がまとめて異動します。
        </p>
        {rows.length === 0 ? (
          <p className="rounded-lg bg-[#fafafa] px-3 py-6 text-center text-sm text-[#909090]">
            まだ誰も追加されていません。上の欄から対象者を追加してください。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                  <th className="px-3 py-2 font-medium">社員番号</th>
                  <th className="px-3 py-2 font-medium">氏名</th>
                  <th className="px-3 py-2 font-medium">現所属</th>
                  <th className="px-3 py-2 font-medium">新所属 *</th>
                  <th className="px-3 py-2 font-medium">異動日 *</th>
                  <th className="px-3 py-2 font-medium">理由</th>
                  <th className="px-3 py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const emp = byId.get(row.employeeId);
                  return (
                    <tr key={row.employeeId} className="border-b border-[#f0f0f0] align-top last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-[#707070]">{emp?.employeeNo}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[#333333]">{emp?.name}</td>
                      <td className="px-3 py-2 text-xs text-[#707070]">{emp?.orgUnitName ?? "（未配置）"}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label="新所属"
                          value={row.toOrgUnitId}
                          onChange={(e) => patchRow(i, { toOrgUnitId: e.target.value })}
                          className={`${INPUT} min-w-[200px]`}
                        >
                          <option value="">選んでください</option>
                          {orgOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {"　".repeat(o.depth)}
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label="異動日"
                          type="date"
                          value={row.effectiveDate}
                          onChange={(e) => patchRow(i, { effectiveDate: e.target.value })}
                          className={INPUT}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label="理由"
                          list="reasonSuggestions"
                          value={row.reason}
                          onChange={(e) => patchRow(i, { reason: e.target.value })}
                          className={`${INPUT} min-w-[160px]`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-label="行を削除"
                          onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                          className="cursor-pointer rounded-lg border border-[#e5e5e5] p-2 text-[#909090] hover:bg-[#fdecec] hover:text-[#b91c1c]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {state.error && (
        <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>一括申請書を作成（{rows.length}名）</SubmitButton>
        <Link
          href="/transfers"
          className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          キャンセル
        </Link>
      </div>
    </form>
    </div>
  );
}

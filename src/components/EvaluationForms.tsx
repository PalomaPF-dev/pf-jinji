"use client";

import { useActionState } from "react";
import SubmitButton from "./SubmitButton";
import {
  finalizeEvaluationAction,
  openPeriodAction,
  saveScoresAction,
  type EvaluationActionState,
} from "@/app/evaluations/actions";
import { pick } from "@/lib/formState";
import { EVALUATION_RANKS, type Evaluation, type EvaluationItem } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

function Notice({ state }: { state: EvaluationActionState }) {
  if (state.error) {
    return <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>;
  }
  if (state.message) {
    return <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>;
  }
  return null;
}

/** 評価期を開く（在籍者ぶんの評価票を用意する）。 */
export function OpenPeriodForm({ defaultYear, defaultHalf }: { defaultYear: number; defaultHalf: "H1" | "H2" }) {
  const [state, action] = useActionState(openPeriodAction, {} as EvaluationActionState);
  const v = state.values;
  return (
    <form action={action} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">評価期を開く</h2>
      <p className="mb-3 text-xs text-[#707070]">
        指定した期の評価票を、在籍者ぶんまとめて用意します。既にある人は変更しません。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="fiscalYear" className="mb-1 block text-xs font-medium text-[#707070]">
            年度
          </label>
          <input
            id="fiscalYear"
            name="fiscalYear"
            inputMode="numeric"
            defaultValue={pick(v, "fiscalYear", String(defaultYear))}
            className="w-24 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <div>
          <label htmlFor="half" className="mb-1 block text-xs font-medium text-[#707070]">
            期
          </label>
          <select
            id="half"
            name="half"
            key={`half-${v?.half ?? ""}`}
            defaultValue={v?.half ?? defaultHalf}
            className="rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          >
            <option value="H1">上期</option>
            <option value="H2">下期</option>
          </select>
        </div>
        <SubmitButton>この期を開く</SubmitButton>
      </div>
      <Notice state={state} />
    </form>
  );
}

/**
 * 一次／二次評価の入力。
 * 二次評価だけが総合評価ランクを決められる（最終評価は二次のため）。
 */
export function ScoreForm({
  evaluation,
  items,
  stage,
}: {
  evaluation: Evaluation;
  items: EvaluationItem[];
  stage: "primary" | "secondary";
}) {
  const [state, action] = useActionState(saveScoresAction, {} as EvaluationActionState);
  const v = state.values;
  const saved = stage === "primary" ? evaluation.primaryScores : evaluation.secondaryScores;
  const comment = stage === "primary" ? evaluation.primaryComment : evaluation.secondaryComment;
  const locked = evaluation.status === "finalized";

  const categories = Array.from(new Set(items.map((i) => i.category)));

  return (
    <form action={action} className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <input type="hidden" name="id" value={evaluation.id} />
      <input type="hidden" name="stage" value={stage} />
      <h2 className="mb-4 text-sm font-bold text-[#333333]">
        {stage === "primary" ? "一次評価" : "二次評価"}
      </h2>

      {categories.map((cat) => (
        <fieldset key={cat} className="mb-4">
          <legend className="mb-2 text-xs font-medium text-[#909090]">{cat || "その他"}</legend>
          <div className="space-y-2">
            {items
              .filter((i) => i.category === cat)
              .map((it) => (
                <div key={it.code} className="grid grid-cols-[1fr_6rem] items-center gap-3">
                  <label htmlFor={`${stage}_${it.code}`} className="text-sm text-[#555555]">
                    {it.name}
                    <span className="ml-1 text-xs text-[#909090]">（{it.maxScore}点満点）</span>
                  </label>
                  <input
                    id={`${stage}_${it.code}`}
                    name={`score_${it.code}`}
                    type="number"
                    min={0}
                    max={it.maxScore}
                    disabled={locked}
                    defaultValue={pick(v, `score_${it.code}`, saved[it.code]?.toString() ?? null)}
                    className={`${INPUT} text-right disabled:bg-[#fafafa]`}
                  />
                </div>
              ))}
          </div>
        </fieldset>
      ))}

      {stage === "secondary" && (
        <div className="mb-4">
          <label htmlFor="overallRank" className="mb-1 block text-sm font-medium text-[#555555]">
            総合評価
          </label>
          <select
            id="overallRank"
            name="overallRank"
            disabled={locked}
            key={`rank-${v?.overallRank ?? ""}`}
            defaultValue={v?.overallRank ?? evaluation.overallRank ?? ""}
            className={`${INPUT} disabled:bg-[#fafafa]`}
          >
            <option value="">—</option>
            {EVALUATION_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[#909090]">確定するには総合評価が必要です。</p>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor={`comment_${stage}`} className="mb-1 block text-sm font-medium text-[#555555]">
          所見
        </label>
        <textarea
          id={`comment_${stage}`}
          name="comment"
          rows={3}
          disabled={locked}
          defaultValue={pick(v, "comment", comment)}
          className={`${INPUT} disabled:bg-[#fafafa]`}
        />
      </div>

      <Notice state={state} />

      {!locked && (
        <div className="mt-4">
          <SubmitButton>{stage === "primary" ? "一次評価を保存" : "二次評価を保存"}</SubmitButton>
        </div>
      )}
    </form>
  );
}

/** 考課の確定。以後は変更できない。 */
export function FinalizeForm({ evaluation }: { evaluation: Evaluation }) {
  const [state, action] = useActionState(finalizeEvaluationAction, {} as EvaluationActionState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={evaluation.id} />
      <SubmitButton
        confirm={`${evaluation.employeeName} さんの ${evaluation.period} の考課を確定します。確定後は変更できません。よろしいですか？`}
      >
        考課を確定する
      </SubmitButton>
      <Notice state={state} />
    </form>
  );
}

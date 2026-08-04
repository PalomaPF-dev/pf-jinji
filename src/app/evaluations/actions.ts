"use server";

import { revalidatePath } from "next/cache";
import { assertEvaluationSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { formValues, type FormValues } from "@/lib/formState";
import {
  finalizeEvaluation,
  getEvaluation,
  listEvaluationItems,
  openPeriod,
  saveScores,
  validateScores,
  type EvaluationScoreInput,
} from "@/lib/evaluations";
import { EVALUATION_RANKS, type EvaluationHalf, type EvaluationRank } from "@/lib/types";

export interface EvaluationActionState {
  error?: string;
  message?: string;
  values?: FormValues;
}

function str(form: FormData, key: string): string {
  return (form.get(key) ?? "").toString().trim();
}

/** 評価期を開く（在籍者ぶんの空の評価を用意する）。 */
export async function openPeriodAction(
  _prev: EvaluationActionState,
  form: FormData,
): Promise<EvaluationActionState> {
  const s = await assertEvaluationSession();
  const fiscalYear = Number(str(form, "fiscalYear"));
  const half = str(form, "half") as EvaluationHalf;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    return { error: "年度を正しく入力してください。", values: formValues(form) };
  }
  if (half !== "H1" && half !== "H2") {
    return { error: "上期・下期を選んでください。", values: formValues(form) };
  }

  const created = await openPeriod(fiscalYear, half);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_evaluation",
    targetType: "evaluation_period",
    targetLabel: `${fiscalYear}${half}`,
    detail: { created },
  });
  revalidatePath("/evaluations");
  return {
    message:
      created > 0
        ? `${fiscalYear}年度${half === "H1" ? "上期" : "下期"}の対象者 ${created} 名を追加しました。`
        : "追加された対象者はありません（既に用意済みです）。",
  };
}

/** 一次／二次評価の保存。 */
export async function saveScoresAction(
  _prev: EvaluationActionState,
  form: FormData,
): Promise<EvaluationActionState> {
  const s = await assertEvaluationSession();
  const id = str(form, "id");
  const stage = str(form, "stage") === "secondary" ? "secondary" : "primary";
  if (!id) return { error: "対象が指定されていません。" };

  const items = await listEvaluationItems();
  const scores: Record<string, number> = {};
  for (const it of items) {
    const raw = str(form, `score_${it.code}`);
    if (raw === "") continue;
    scores[it.code] = Number(raw);
  }
  const rankRaw = str(form, "overallRank");
  const overallRank = EVALUATION_RANKS.includes(rankRaw as EvaluationRank)
    ? (rankRaw as EvaluationRank)
    : null;

  const input: EvaluationScoreInput = {
    stage,
    scores,
    comment: str(form, "comment") || null,
    overallRank,
  };
  const problem = validateScores(input, items);
  if (problem) return { error: problem, values: formValues(form) };

  try {
    await saveScores(id, input, s.grant.loginId, s.grant.name, items);
  } catch (e) {
    return { error: (e as Error).message, values: formValues(form) };
  }

  const v = await getEvaluation(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_evaluation",
    targetType: "evaluation",
    targetId: id,
    targetLabel: v ? `${v.period} ${v.employeeName}` : id,
    detail: { stage },
  });
  revalidatePath("/evaluations");
  revalidatePath(`/evaluations/${id}`);
  return { message: stage === "primary" ? "一次評価を保存しました。" : "二次評価を保存しました。" };
}

/** 考課の確定。以後は変更できない。 */
export async function finalizeEvaluationAction(
  _prev: EvaluationActionState,
  form: FormData,
): Promise<EvaluationActionState> {
  const s = await assertEvaluationSession();
  const id = str(form, "id");
  try {
    await finalizeEvaluation(id, s.grant.loginId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const v = await getEvaluation(id);
  await recordAudit({
    actorLoginId: s.grant.loginId,
    actorName: s.grant.name,
    action: "update_evaluation",
    targetType: "evaluation",
    targetId: id,
    targetLabel: v ? `${v.period} ${v.employeeName}` : id,
    detail: { event: "finalize", rank: v?.overallRank },
  });
  revalidatePath("/evaluations");
  revalidatePath(`/evaluations/${id}`);
  return { message: "考課を確定しました。" };
}

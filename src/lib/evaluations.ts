import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import {
  EVALUATION_RANKS,
  periodOf,
  type Evaluation,
  type EvaluationHalf,
  type EvaluationItem,
  type EvaluationRank,
  type EvaluationStatus,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function scores(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function mapEvaluation(r: any): Evaluation {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeNo: r.employee_no ?? "",
    employeeName: r.employee_name ?? "",
    orgUnitName: r.org_unit_name ?? null,
    period: r.period,
    fiscalYear: Number(r.fiscal_year ?? 0),
    half: (r.half as EvaluationHalf) ?? "H1",
    primaryEvaluator: r.primary_evaluator ?? null,
    primaryName: r.primary_name ?? null,
    primaryScores: scores(r.primary_scores),
    primaryComment: r.primary_comment ?? null,
    primaryDoneAt: r.primary_done_at ? new Date(r.primary_done_at).toISOString() : null,
    secondaryEvaluator: r.secondary_evaluator ?? null,
    secondaryName: r.secondary_name ?? null,
    secondaryScores: scores(r.secondary_scores),
    secondaryComment: r.secondary_comment ?? null,
    secondaryDoneAt: r.secondary_done_at ? new Date(r.secondary_done_at).toISOString() : null,
    overallRank: (r.overall_rank as EvaluationRank | null) ?? null,
    totalScore: r.total_score == null ? null : Number(r.total_score),
    status: (r.status as EvaluationStatus) ?? "draft",
    finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
    finalizedBy: r.finalized_by ?? null,
  };
}

// ===== 考課項目マスター =====

export async function listEvaluationItems(activeOnly = true): Promise<EvaluationItem[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = activeOnly
    ? await sql`SELECT * FROM jinji_evaluation_items WHERE active ORDER BY sort ASC, code ASC`
    : await sql`SELECT * FROM jinji_evaluation_items ORDER BY sort ASC, code ASC`;
  return rows.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    category: (r.category as string) ?? "",
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    maxScore: Number(r.max_score ?? 5),
    sort: Number(r.sort ?? 0),
    active: Boolean(r.active),
  }));
}

// ===== 考課 =====

export async function listEvaluations(period: string | null, employeeId?: string | null): Promise<Evaluation[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT v.*, e.employee_no, e.name AS employee_name, o.name AS org_unit_name
    FROM jinji_evaluations v
    JOIN jinji_employees e ON e.id = v.employee_id
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE (${period}::text IS NULL OR v.period = ${period})
      AND (${employeeId ?? null}::uuid IS NULL OR v.employee_id = ${employeeId ?? null})
    ORDER BY v.period DESC, (e.name_kana IS NULL), e.name_kana ASC`;
  return rows.map(mapEvaluation);
}

export async function getEvaluation(id: string): Promise<Evaluation | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT v.*, e.employee_no, e.name AS employee_name, o.name AS org_unit_name
    FROM jinji_evaluations v
    JOIN jinji_employees e ON e.id = v.employee_id
    LEFT JOIN jinji_org_units o ON o.id = e.org_unit_id
    WHERE v.id = ${id} LIMIT 1`;
  return rows[0] ? mapEvaluation(rows[0]) : null;
}

/** 登録済みの評価期を新しい順に。 */
export async function listPeriods(): Promise<{ period: string; count: number }[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT period, count(*)::int AS n FROM jinji_evaluations GROUP BY period ORDER BY period DESC`;
  return rows.map((r) => ({ period: r.period as string, count: r.n as number }));
}

/**
 * 評価期の対象者を用意する（在籍者ぶんの空の評価を作る）。
 * 既にある行は触らない。何件作ったかを返す。
 */
export async function openPeriod(fiscalYear: number, half: EvaluationHalf): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const period = periodOf(fiscalYear, half);
  const rows = await sql`
    INSERT INTO jinji_evaluations (employee_id, period, fiscal_year, half)
    SELECT e.id, ${period}, ${fiscalYear}, ${half}
    FROM jinji_employees e
    WHERE e.status = 'active'
    ON CONFLICT (employee_id, period) DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** 合計点。二次評価が入っていればそちらを優先する（最終評価は二次のため）。 */
export function totalOf(evaluation: Evaluation, items: EvaluationItem[]): number {
  const src = Object.keys(evaluation.secondaryScores).length > 0
    ? evaluation.secondaryScores
    : evaluation.primaryScores;
  return items.reduce((sum, it) => sum + (src[it.code] ?? 0), 0);
}

export function maxTotalOf(items: EvaluationItem[]): number {
  return items.reduce((sum, it) => sum + it.maxScore, 0);
}

export interface EvaluationScoreInput {
  /** "primary" = 一次評価, "secondary" = 二次評価 */
  stage: "primary" | "secondary";
  scores: Record<string, number>;
  comment: string | null;
  overallRank: EvaluationRank | null;
}

export function validateScores(
  input: EvaluationScoreInput,
  items: EvaluationItem[],
): string | null {
  for (const it of items) {
    const v = input.scores[it.code];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) return `「${it.name}」の点数は0以上で入力してください。`;
    if (v > it.maxScore) return `「${it.name}」の上限は${it.maxScore}点です。`;
  }
  if (input.overallRank && !EVALUATION_RANKS.includes(input.overallRank)) {
    return "総合評価が不正です。";
  }
  return null;
}

/**
 * 一次／二次評価を保存する。確定済みは変更できない。
 * 状態は 一次のみ→primary_done、二次まで→secondary_done へ進める。
 */
export async function saveScores(
  id: string,
  input: EvaluationScoreInput,
  evaluatorLoginId: string,
  evaluatorName: string,
  items: EvaluationItem[],
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status, secondary_scores FROM jinji_evaluations WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  if ((cur[0].status as string) === "finalized") {
    throw new Error("確定済みの考課は変更できません。");
  }

  const total = items.reduce((sum, it) => sum + (input.scores[it.code] ?? 0), 0);

  if (input.stage === "primary") {
    // 二次が未入力のうちは一次の点数を合計として持つ
    const hasSecondary = Object.keys(scores(cur[0].secondary_scores)).length > 0;
    await sql`
      UPDATE jinji_evaluations SET
        primary_evaluator = ${evaluatorLoginId},
        primary_name = ${evaluatorName},
        primary_scores = ${JSON.stringify(input.scores)}::jsonb,
        primary_comment = ${input.comment},
        primary_done_at = NOW(),
        total_score = CASE WHEN ${hasSecondary} THEN total_score ELSE ${total} END,
        status = CASE WHEN status = 'draft' THEN 'primary_done' ELSE status END,
        updated_at = NOW()
      WHERE id = ${id}`;
    return;
  }

  await sql`
    UPDATE jinji_evaluations SET
      secondary_evaluator = ${evaluatorLoginId},
      secondary_name = ${evaluatorName},
      secondary_scores = ${JSON.stringify(input.scores)}::jsonb,
      secondary_comment = ${input.comment},
      secondary_done_at = NOW(),
      overall_rank = ${input.overallRank},
      total_score = ${total},
      status = CASE WHEN status IN ('draft','primary_done') THEN 'secondary_done' ELSE status END,
      updated_at = NOW()
    WHERE id = ${id}`;
}

/** 考課を確定する。以後は変更できない。 */
export async function finalizeEvaluation(id: string, byLoginId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const cur = await sql`SELECT status, overall_rank FROM jinji_evaluations WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("対象が見つかりません。");
  if ((cur[0].status as string) === "draft") {
    throw new Error("評価が入力されていません。一次評価から入力してください。");
  }
  if (!cur[0].overall_rank) {
    throw new Error("総合評価が未入力です。二次評価で総合評価を選んでから確定してください。");
  }
  await sql`
    UPDATE jinji_evaluations
    SET status = 'finalized', finalized_at = NOW(), finalized_by = ${byLoginId}, updated_at = NOW()
    WHERE id = ${id}`;
}

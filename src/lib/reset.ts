import { getSql } from "./neon";
import { ensureSchema } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 人事データの初期化（社員台帳と組織を全部消す）。
 *
 * 名簿を取り込み直すときに使う。取込は既存の行を更新する作りなので、
 * 一度おかしくなった所属や組織の形は、消してから入れ直すのがいちばん確実。
 *
 * ■ 消すもの
 *   社員台帳・組織・異動申請・継続雇用申請・人事考課・基本給与・保有資格・異動案・採番
 *   （社員に紐づくものは外部キーの CASCADE でも落ちるが、順番に消して件数を返す）
 *
 * ■ 残すもの
 *   - 利用許可名簿（jinji_admins）… 消すとアプリに入れなくなる
 *   - 資格マスター・考課項目 … 取り込み直しても作られないマスター
 *   - 監査ログ … 「いつ誰が初期化したか」を残すため
 *   - ログイン情報（users）… ポータルの権限で入るので消さない
 *
 * 取り消せないので、呼び出し側で必ず確認を取ること。
 */
export interface ResetResult {
  employees: number;
  orgUnits: number;
  transfers: number;
  reemployments: number;
  evaluations: number;
  salaries: number;
  qualifications: number;
  plans: number;
}

export async function resetHrData(): Promise<ResetResult> {
  await ensureSchema();
  const sql = getSql();

  // 消す前の件数（画面に出す）
  const before = await sql`
    SELECT
      (SELECT count(*)::int FROM jinji_employees)      AS employees,
      (SELECT count(*)::int FROM jinji_org_units)      AS org_units,
      (SELECT count(*)::int FROM jinji_transfers)      AS transfers,
      (SELECT count(*)::int FROM jinji_reemployments)  AS reemployments,
      (SELECT count(*)::int FROM jinji_evaluations)    AS evaluations,
      (SELECT count(*)::int FROM jinji_salaries)       AS salaries,
      (SELECT count(*)::int FROM jinji_qualifications) AS qualifications,
      (SELECT count(*)::int FROM jinji_org_plans)      AS plans`;
  const b = before[0] as any;

  // DELETE ではなく TRUNCATE を使う。
  // DELETE は消した行を「不要になった行」として残すため、ディスクは減らない
  // （VACUUM を待つ必要がある）。DB の容量上限に当たっている状態では、
  // その DELETE 自体が「could not extend file」で失敗する。
  // TRUNCATE はテーブルを作り直すので、その場で容量が空く。
  await sql`
    TRUNCATE TABLE
      jinji_employees, jinji_org_units, jinji_transfers, jinji_transfer_items,
      jinji_transfer_approvals, jinji_reemployments, jinji_reemployment_approvals,
      jinji_evaluations, jinji_salaries, jinji_qualifications,
      jinji_org_plans, jinji_org_plan_moves, jinji_counters
    RESTART IDENTITY CASCADE`;

  return {
    employees: Number(b.employees ?? 0),
    orgUnits: Number(b.org_units ?? 0),
    transfers: Number(b.transfers ?? 0),
    reemployments: Number(b.reemployments ?? 0),
    evaluations: Number(b.evaluations ?? 0),
    salaries: Number(b.salaries ?? 0),
    qualifications: Number(b.qualifications ?? 0),
    plans: Number(b.plans ?? 0),
  };
}

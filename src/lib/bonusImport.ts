import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { XlsxSheet } from "./xlsx";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 賞与マスタ（給与・考課の一覧Excel）の取込。
 *
 * 実物はシート名が「賞与マスタ202607」、7行目が見出しで、
 * 社員番号・基本給・各種手当（約20列）・考課（2024最終/2025中間/2025最終）が並ぶ。
 *
 * 対応づけ:
 *  - 給与   … 基本給＋手当列 → jinji_salaries に履歴1行（適用開始はシート名の年月）
 *  - 考課   … 「YYYY中間」→ その年度の上期(H1)、「YYYY最終」→ 下期(H2) の確定済み考課
 *
 * 手当は0円の列を省き、金額が入っている列だけを {名称, 金額} で保存する。
 * 考課の値が数値でないもの（#N/A・─・評価対象外など）はその期を飛ばす。
 */

/** 見出し行を探す（「社員番号」を含む最初の行）。見つからなければ -1。 */
export function findHeaderRow(sheet: XlsxSheet, maxScan = 20): number {
  for (let i = 0; i < Math.min(sheet.rows.length, maxScan); i++) {
    if (sheet.rows[i].some((c) => (c ?? "").replace(/[\s　]/g, "") === "社員番号")) return i;
  }
  return -1;
}

/** 賞与マスタらしいか（取込前の判定）。 */
export function looksLikeBonusMaster(sheet: XlsxSheet): boolean {
  const h = findHeaderRow(sheet);
  if (h < 0) return false;
  const heads = sheet.rows[h].map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
  return heads.includes("基本給") && heads.some((x) => /考課/.test(x));
}

/**
 * 手当として保存する列。実データ全1708行で
 * **基本給＋この構成の合計 ＝ 給与月額** が成立することを確認して決めている。
 *
 * 含めない列とその理由:
 *  - 役職（直）（連）・職務手当（直）（連） … 「役職手当」「職務手当」の内訳。
 *    両方を含めると二重計上になる。まれに内訳と集計が食い違う月があり、
 *    そのときは**集計列のほうが実際の支給額**だった（内訳ではなく集計列を採る）。
 *  - 登録給 … 支給されない参照値（含めると給与月額と合わなくなる実例あり）
 *  - 基本単価・基準単価 … 賞与の算定基数。月例の手当ではない
 *  - 所定勤務時間 … 金額ではない
 */
const ALLOWANCE_COLUMNS = [
  "職能",
  "特別手当",
  "営業手当（連）",
  "第二基本給",
  "営時外手当",
  "勤務地手当（連）",
  "単身赴任手当",
  "地域限定住宅手当",
  "住宅手当",
  "扶養家族手当（連）",
  "資格手当",
  "その他手当",
  "テック職務手当（連）",
  "役職手当",
  "職務手当",
] as const;

export interface BonusImportResult {
  total: number;
  salariesCreated: number;
  salariesUpdated: number;
  evaluationsCreated: number;
  evaluationsSkipped: number;
  /** 社員台帳に居ない社員番号（給与も考課も取り込まない） */
  missing: string[];
  errors: { row: number; employeeNo: string; message: string }[];
}

/** シート名「賞与マスタ202607」→ "2026-07-01"。読めなければ null。 */
export function effectiveFromOfSheetName(name: string): string | null {
  const m = name.match(/(20\d{2})(0[1-9]|1[0-2])/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

const num = (v: string | undefined): number | null => {
  const s = (v ?? "").replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export async function importBonusMaster(
  sheet: XlsxSheet,
  options: {
    effectiveFrom: string;
    actorLoginId: string;
    actorName: string;
    /** 考課も取り込むか（can_evaluation が無ければ false で呼ぶ） */
    includeEvaluations: boolean;
  },
): Promise<BonusImportResult> {
  await ensureSchema();
  const sql = getSql();

  const result: BonusImportResult = {
    total: 0,
    salariesCreated: 0,
    salariesUpdated: 0,
    evaluationsCreated: 0,
    evaluationsSkipped: 0,
    missing: [],
    errors: [],
  };

  const headerAt = findHeaderRow(sheet);
  if (headerAt < 0) throw new Error("見出し行（社員番号）が見つかりません。");
  const heads = sheet.rows[headerAt].map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
  const col = (label: string) => heads.indexOf(label.replace(/[\s　\n]/g, ""));

  const cEmp = col("社員番号");
  const cBase = col("基本給");
  if (cBase < 0) throw new Error("「基本給」列が見つかりません。");
  const allowanceCols = ALLOWANCE_COLUMNS.map((label) => ({ label, at: col(label) })).filter(
    (x) => x.at >= 0,
  );
  // 考課列: 「2024最終考課」「2025中間考課」のような見出しを拾う
  const evalCols: { at: number; period: string; fiscalYear: number; half: "H1" | "H2" }[] = [];
  heads.forEach((h, at) => {
    const m = h.match(/^(20\d{2})(中間|最終)考課$/);
    if (!m) return;
    const fiscalYear = Number(m[1]);
    const half = m[2] === "中間" ? "H1" : "H2";
    evalCols.push({ at, period: `${fiscalYear}${half}`, fiscalYear, half });
  });

  interface ParsedRow {
    rowNo: number;
    employeeNo: string;
    baseSalary: number;
    allowances: { name: string; amount: number }[];
    evals: { period: string; fiscalYear: number; half: string; score: number }[];
  }
  const parsed: ParsedRow[] = [];
  for (let i = headerAt + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const employeeNo = (row[cEmp] ?? "").trim();
    if (!employeeNo) continue;
    result.total++;
    const rowNo = i + 1;
    const baseSalary = num(row[cBase]);
    if (baseSalary === null) {
      result.errors.push({ row: rowNo, employeeNo, message: "基本給が数値ではありません。" });
      continue;
    }
    const allowances = allowanceCols
      .map((x) => ({ name: x.label, amount: num(row[x.at]) ?? 0 }))
      .filter((a) => a.amount !== 0);
    const evals = evalCols
      .map((e) => ({ ...e, score: num(row[e.at]) }))
      .filter((e): e is (typeof evalCols)[number] & { score: number } => e.score !== null && e.score > 0)
      .map((e) => ({ period: e.period, fiscalYear: e.fiscalYear, half: e.half, score: e.score }));
    parsed.push({ rowNo, employeeNo, baseSalary, allowances, evals });
  }

  // 社員番号 → id（台帳に居ない人は取り込まない。給与から人を作らない）
  const empRows = await sql`
    SELECT id, employee_no FROM jinji_employees
    WHERE employee_no = ANY(${parsed.map((p) => p.employeeNo)}::text[])`;
  const idByNo = new Map(empRows.map((r: any) => [r.employee_no as string, r.id as string]));
  const rows = parsed.filter((p) => {
    if (idByNo.has(p.employeeNo)) return true;
    result.missing.push(p.employeeNo);
    return false;
  });

  // ===== 給与（500件ずつ・1文で upsert） =====
  const reason = `賞与マスタ取込（適用 ${options.effectiveFrom}）`;
  const CHUNK = 500;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const part = rows.slice(start, start + CHUNK);
    try {
      const ret = await sql`
        INSERT INTO jinji_salaries
          (employee_id, effective_from, base_salary, allowances,
           revision_kind, reason, decided_by, decided_name)
        SELECT id, ${options.effectiveFrom}::date, base, alw::jsonb, '新規登録', ${reason},
               ${options.actorLoginId}, ${options.actorName}
        FROM unnest(
          ${part.map((p) => idByNo.get(p.employeeNo)!)}::uuid[],
          ${part.map((p) => p.baseSalary)}::int[],
          ${part.map((p) => JSON.stringify(p.allowances))}::text[]
        ) AS v(id, base, alw)
        ON CONFLICT (employee_id, effective_from) WHERE voided_at IS NULL
        DO UPDATE SET base_salary = EXCLUDED.base_salary,
                      allowances  = EXCLUDED.allowances,
                      reason      = EXCLUDED.reason
        RETURNING (xmax = 0) AS created`;
      for (const r of ret) {
        if (r.created) result.salariesCreated++;
        else result.salariesUpdated++;
      }
    } catch (e) {
      result.errors.push({
        row: part[0].rowNo,
        employeeNo: `${part[0].employeeNo}〜${part[part.length - 1].employeeNo}`,
        message: `給与 ${part.length} 件の取込に失敗: ${(e as Error).message}`,
      });
    }
  }

  // ===== 考課（確定済みとして登録。既にある期は上書きしない） =====
  if (options.includeEvaluations) {
    const flat = rows.flatMap((p) =>
      p.evals.map((e) => ({ employeeId: idByNo.get(p.employeeNo)!, ...e })),
    );
    for (let start = 0; start < flat.length; start += CHUNK) {
      const part = flat.slice(start, start + CHUNK);
      try {
        const ret = await sql`
          INSERT INTO jinji_evaluations
            (employee_id, period, fiscal_year, half, total_score,
             status, finalized_at, finalized_by, secondary_comment)
          SELECT id, period, fy, half, score, 'finalized', NOW(), ${options.actorLoginId}, ${reason}
          FROM unnest(
            ${part.map((x) => x.employeeId)}::uuid[],
            ${part.map((x) => x.period)}::text[],
            ${part.map((x) => x.fiscalYear)}::int[],
            ${part.map((x) => x.half)}::text[],
            ${part.map((x) => x.score)}::numeric[]
          ) AS v(id, period, fy, half, score)
          ON CONFLICT (employee_id, period) DO NOTHING
          RETURNING id`;
        result.evaluationsCreated += ret.length;
        result.evaluationsSkipped += part.length - ret.length;
      } catch (e) {
        result.errors.push({
          row: 0,
          employeeNo: "-",
          message: `考課 ${part.length} 件の取込に失敗: ${(e as Error).message}`,
        });
      }
    }
  }

  return result;
}

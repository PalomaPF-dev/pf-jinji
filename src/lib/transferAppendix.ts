import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { listTransferItems } from "./transfers";
import { excelDateToIso, type XlsxSheet } from "./xlsx";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 一括異動申請の**別紙（異動者一覧）**の行。
 * 実物の一覧表の列（工場名・異動日・個人コード・個人氏名・所属コード・総所属・
 * 新所属組織コード・新所属組織名・理由）に合わせている。
 */
export interface AppendixRow {
  /** 工場名（「大口工場」→「大口」のように末尾の「工場」を省いた呼び名） */
  factory: string;
  /** 異動日（8月1日 のような表記） */
  effectiveDate: string;
  employeeNo: string;
  employeeName: string;
  /** 現所属の8桁コード */
  fromCode: string;
  /** 総所属（本部からの名称の連なり） */
  fromPath: string;
  toCode: string;
  toName: string;
  reason: string;
}

export const APPENDIX_HEADERS = [
  "工場名",
  "異動日",
  "個人コード",
  "個人氏名（姓 名）",
  "所属コード",
  "総所属コード",
  "新所属組織コード",
  "新所属組織名",
  "理由",
] as const;

const jpDate = (iso: string | null): string => {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}月${Number(d)}日`;
};

/** 別紙の行を組み立てる。並びは申請時の登録順。 */
export async function buildAppendixRows(transferId: string): Promise<AppendixRow[]> {
  await ensureSchema();
  const sql = getSql();
  const [items, units] = await Promise.all([
    listTransferItems(transferId),
    sql`SELECT id, parent_id, name FROM jinji_org_units`,
  ]);
  const byId = new Map(units.map((u: any) => [u.id as string, u]));

  /** 根 → 対象組織 の名称の連なりと、本部直下の祖先名。 */
  const pathOf = (orgId: string | null): { path: string; top: string } => {
    if (!orgId) return { path: "", top: "" };
    const chain: any[] = [];
    const seen = new Set<string>();
    let cur = byId.get(orgId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    chain.reverse(); // 根 → 葉
    const top = chain.length >= 2 ? (chain[1].name as string) : ((chain[0]?.name as string) ?? "");
    return { path: chain.map((u) => u.name as string).join(""), top };
  };

  return items.map((i) => {
    const from = pathOf(i.fromOrgUnitId);
    return {
      factory: from.top.replace(/工場$/, ""),
      effectiveDate: jpDate(i.effectiveDate),
      employeeNo: i.employeeNo,
      employeeName: i.employeeName,
      fromCode: i.fromOrgUnitCode ?? "",
      fromPath: from.path,
      toCode: i.toOrgUnitCode ?? "",
      toName: i.toOrgUnitName ?? "",
      reason: i.reason ?? "",
    };
  });
}

// ===== 別紙のExcel取込 =====

/**
 * 取り込んだ1行。画面のフォームの行にそのまま流し込める形で返す。
 * 突合できなかった行も、理由を添えて返す（黙って落とすと数が合わなくなるため）。
 */
export interface AppendixImportRow {
  rowNo: number;
  employeeNo: string;
  employeeName: string;
  /** 社員台帳の id。見つからなければ null */
  employeeId: string | null;
  /** 新所属の組織 id。見つからなければ null */
  toOrgUnitId: string | null;
  toCode: string;
  toName: string;
  effectiveDate: string;
  reason: string;
  /** 取り込めない理由（null なら取込可） */
  problem: string | null;
}

export interface AppendixImportResult {
  rows: AppendixImportRow[];
  /** そのまま追加できる行数 */
  ready: number;
  /** 突合できなかった行数 */
  problems: number;
}

/** 見出し行を探す（「個人コード」または「社員番号」を含む最初の行）。 */
function findAppendixHeader(sheet: XlsxSheet, maxScan = 10): number {
  for (let i = 0; i < Math.min(sheet.rows.length, maxScan); i++) {
    const cells = sheet.rows[i].map((c) => (c ?? "").replace(/[\s　]+/g, ""));
    if (cells.some((c) => c === "個人コード" || c === "社員番号")) return i;
  }
  return -1;
}

/** 別紙の一覧表らしいか（取込前の判定）。 */
export function looksLikeAppendix(sheet: XlsxSheet): boolean {
  const h = findAppendixHeader(sheet);
  if (h < 0) return false;
  const cells = sheet.rows[h].map((c) => (c ?? "").replace(/[\s　]+/g, ""));
  return cells.some((c) => /新所属/.test(c));
}

/**
 * 「M月D日」「2026/9/1」「45900」などを ISO 日付にする。
 * 月日だけの表記は年が無いので、既定年（申請の異動日の年）を補う。
 */
function parseAppendixDate(raw: string, defaultYear: number): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const md = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (md) {
    return `${defaultYear}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  }
  return excelDateToIso(s);
}

/**
 * 別紙のExcelを読み、一括異動申請の行に変換する。
 *
 * 突合は**コード優先**。個人コード（社員番号）で社員を、新所属組織コード（8桁）で
 * 組織を引く。コードで引けないときだけ名称で探す（人が手で書き足した行を拾うため）。
 * scopeOrgIds を渡すと、その範囲外の社員は取り込まない（管理者の工場スコープ）。
 */
export async function parseAppendixSheet(
  sheet: XlsxSheet,
  options: { defaultEffectiveDate: string; scopeOrgIds?: string[] | null },
): Promise<AppendixImportResult> {
  await ensureSchema();
  const sql = getSql();

  const headerAt = findAppendixHeader(sheet);
  if (headerAt < 0) throw new Error("見出し行（個人コード）が見つかりません。");
  const heads = sheet.rows[headerAt].map((c) => (c ?? "").replace(/[\s　]+/g, ""));
  const col = (...labels: string[]) => {
    for (const l of labels) {
      const at = heads.findIndex((h) => h === l);
      if (at >= 0) return at;
    }
    return -1;
  };
  const cNo = col("個人コード", "社員番号");
  const cName = col("個人氏名（姓名）", "個人氏名", "氏名");
  const cDate = col("異動日", "異動年月日");
  const cToCode = col("新所属組織コード", "新所属コード");
  const cToName = col("新所属組織名", "新所属");
  const cReason = col("理由", "異動理由");
  if (cNo < 0) throw new Error("「個人コード」列が見つかりません。");
  if (cToCode < 0 && cToName < 0) throw new Error("「新所属組織コード」または「新所属組織名」の列が必要です。");

  const defaultYear = Number(options.defaultEffectiveDate.slice(0, 4)) || new Date().getFullYear();

  interface Raw {
    rowNo: number;
    employeeNo: string;
    employeeName: string;
    toCode: string;
    toName: string;
    date: string | null;
    reason: string;
  }
  const raws: Raw[] = [];
  for (let i = headerAt + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const employeeNo = (r[cNo] ?? "").trim();
    if (!employeeNo) continue;
    raws.push({
      rowNo: i + 1,
      employeeNo,
      employeeName: cName >= 0 ? (r[cName] ?? "").trim() : "",
      toCode: cToCode >= 0 ? (r[cToCode] ?? "").trim() : "",
      toName: cToName >= 0 ? (r[cToName] ?? "").trim() : "",
      date: cDate >= 0 ? parseAppendixDate(r[cDate] ?? "", defaultYear) : null,
      reason: cReason >= 0 ? (r[cReason] ?? "").trim() : "",
    });
  }

  // 社員番号の表記ゆれ（先頭ゼロの有無）も引けるようにする
  const noCandidates = new Set<string>();
  for (const r of raws) {
    noCandidates.add(r.employeeNo);
    if (/^\d+$/.test(r.employeeNo)) {
      noCandidates.add(r.employeeNo.padStart(6, "0"));
      noCandidates.add(r.employeeNo.replace(/^0+/, ""));
    }
  }
  const [emps, orgs] = await Promise.all([
    sql`
      SELECT id, employee_no, name, org_unit_id, status FROM jinji_employees
      WHERE employee_no = ANY(${[...noCandidates].filter(Boolean)}::text[])`,
    sql`SELECT id, code, name, workplace_code FROM jinji_org_units`,
  ]);
  const empByNo = new Map<string, any>();
  for (const e of emps) empByNo.set(e.employee_no as string, e);
  const orgByCode = new Map<string, any>();
  const orgByName = new Map<string, any>();
  for (const o of orgs) {
    orgByCode.set(o.code as string, o);
    if (o.workplace_code) orgByCode.set(o.workplace_code as string, o);
    orgByName.set((o.name as string).replace(/[\s　]+/g, ""), o);
  }
  const scope = options.scopeOrgIds ?? null;

  const seen = new Set<string>();
  const rows: AppendixImportRow[] = raws.map((r) => {
    const emp =
      empByNo.get(r.employeeNo) ??
      (/^\d+$/.test(r.employeeNo)
        ? (empByNo.get(r.employeeNo.padStart(6, "0")) ?? empByNo.get(r.employeeNo.replace(/^0+/, "")))
        : undefined);
    const org =
      (r.toCode ? orgByCode.get(r.toCode) : undefined) ??
      (r.toName ? orgByName.get(r.toName.replace(/[\s　]+/g, "")) : undefined);

    let problem: string | null = null;
    if (!emp) problem = `社員番号 ${r.employeeNo} が社員台帳にありません。`;
    else if (emp.status === "retired") problem = "退職者は異動できません。";
    else if (seen.has(emp.id as string)) problem = "同じ社員が複数行にあります。";
    else if (!org) problem = `新所属 ${r.toCode || r.toName} が組織台帳にありません。`;
    else if (scope && !scope.includes((emp.org_unit_id as string | null) ?? "")) {
      problem = "自分の工場の外の社員です。";
    }
    if (emp && !problem) seen.add(emp.id as string);

    return {
      rowNo: r.rowNo,
      employeeNo: r.employeeNo,
      employeeName: r.employeeName || ((emp?.name as string | undefined) ?? ""),
      employeeId: problem ? null : ((emp?.id as string | undefined) ?? null),
      toOrgUnitId: problem ? null : ((org?.id as string | undefined) ?? null),
      toCode: r.toCode || ((org?.code as string | undefined) ?? ""),
      toName: r.toName || ((org?.name as string | undefined) ?? ""),
      effectiveDate: r.date ?? options.defaultEffectiveDate,
      reason: r.reason,
      problem,
    };
  });

  return {
    rows,
    ready: rows.filter((r) => !r.problem).length,
    problems: rows.filter((r) => r.problem).length,
  };
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { XlsxSheet } from "./xlsx";
import { normalizeQualificationCategory, type QualificationCategory } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 資格取得状況（人事システムのExcel）の取込。
 *
 * 実物は2シート:
 *   「全社員明細　YYMMDD」… 1行目が見出し、以降が明細（約5,000行）
 *      会社コード / 組織コード３ / 組織名称漢字３ / 所属組織コード / 所属組織名称漢字 /
 *      社員番号 / ビジネスネーム氏名 / 資格コード / 資格取得日 / 資格認定日 /
 *      適用開始日 / 資格取得番号 / 資格有効期限 / 手当支給区分
 *   「区分マスター」…       資格名（＝コード付き）と区分の対応表（約150件）
 *
 * ■ 値の読み方でつまずくところ
 *   - 資格コードは「1000 (公害防止統括者)」の形。コードと名前に割る。
 *   - 「資格取得番号」は番号ではない。中身は 有資格者 / 有資格者(解任) / 講師 / 代理人 で、
 *     役割・状態を表す。証書番号の欄に入れると意味が変わるので holder_role に入れる。
 *     「(解任)」は半角・全角の括弧が混ざっているので、表示のために正規化する。
 *   - 「手当支給区分」は「1 (支給する)」「0 (支給しない)」。先頭の数字だけ見る。
 *
 * ■ 取り込み直しても壊れないようにする
 *   明細は全社員ぶんの**その時点の一覧**なので、取込は「置き換え」にする。
 *   ただし消すのは前回の取込で作った行（source='import'）だけで、
 *   画面から手で登録した行には触れない。
 *
 * ■ 社員台帳に居ない社員番号
 *   取り込まない（資格から人を作らない）。件数を返して画面に出す。
 */

/** 明細シートの見出し（この並びであることを確かめてから読む）。 */
const DETAIL_HEADS = ["社員番号", "資格コード", "資格取得日"] as const;

export interface QualificationImportResult {
  /** 明細の行数 */
  total: number;
  /** 登録した保有資格の件数 */
  created: number;
  /** 入れ替えのために消した前回取込ぶんの件数 */
  removed: number;
  /** 追加した資格マスターの件数 */
  mastersCreated: number;
  /** 名前・区分を更新した資格マスターの件数 */
  mastersUpdated: number;
  /** 社員台帳に居ない社員番号（取り込まない） */
  missing: string[];
  /** 「区分マスター」に載っていない資格コード（区分は空・その他で登録） */
  ungrouped: { code: string; name: string; count: number }[];
  errors: { row: number; employeeNo: string; message: string }[];
}

/** 「1000 (公害防止統括者)」→ { code: "1000", name: "公害防止統括者" }。 */
export function splitQualificationCode(v: string): { code: string; name: string } {
  const s = (v ?? "").trim();
  const m = s.match(/^(\S+)\s*[(（](.+)[)）]\s*$/);
  if (m) return { code: m[1], name: m[2].trim() };
  // 「1891」のようにコードだけ、「厨房多工程1級」のように名前だけの行もある
  return { code: s, name: s };
}

/** 「2020/06/01」→ "2020-06-01"。読めなければ null。 */
export function toIsoSlash(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** 「1 (支給する)」→ true、「0 (支給しない)」→ false、空 → null。 */
function allowanceOf(v: string | undefined): boolean | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (/^1/.test(s)) return true;
  if (/^0/.test(s)) return false;
  return null;
}

/** 「有資格者（解任）」の全角括弧を半角に寄せる（同じ意味の値を1つにまとめる）。 */
function normalizeRole(v: string | undefined): string | null {
  const s = (v ?? "").trim().replace(/（/g, "(").replace(/）/g, ")");
  return s === "" ? null : s;
}

/**
 * 人事システムの区分 → アプリの区分（絞り込み用の粗い分類）。
 * 対応が付かない区分は「その他」。原文は group_name に残るので情報は失わない。
 */
export function categoryOfGroup(group: string | null): QualificationCategory {
  const g = (group ?? "").replace(/[\s　]/g, "");
  if (!g) return "other";
  if (/法令/.test(g)) return "national";
  if (/技能士|技能検定/.test(g)) return "national";
  if (/特別教育|技能講習/.test(g)) return "skill";
  if (/品質|多工程/.test(g)) return "internal";
  return "other";
}

/** 資格取得状況らしいか（取込前の判定）。 */
export function looksLikeQualificationFile(sheets: XlsxSheet[]): boolean {
  return findDetailSheet(sheets) != null;
}

/** 明細シート（見出しに社員番号・資格コード・資格取得日が並ぶもの）を探す。 */
function findDetailSheet(sheets: XlsxSheet[]): XlsxSheet | null {
  for (const s of sheets) {
    const heads = (s.rows[0] ?? []).map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
    if (DETAIL_HEADS.every((h) => heads.includes(h))) return s;
  }
  return null;
}

/** 区分マスターのシートを探す（見出しに「区分」があるもの）。 */
function findGroupSheet(sheets: XlsxSheet[], detail: XlsxSheet): XlsxSheet | null {
  for (const s of sheets) {
    if (s === detail) continue;
    const heads = (s.rows[0] ?? []).map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
    if (heads.includes("区分")) return s;
  }
  return null;
}

export async function importQualifications(
  sheets: XlsxSheet[],
): Promise<QualificationImportResult> {
  await ensureSchema();
  const sql = getSql();

  const result: QualificationImportResult = {
    total: 0,
    created: 0,
    removed: 0,
    mastersCreated: 0,
    mastersUpdated: 0,
    missing: [],
    ungrouped: [],
    errors: [],
  };

  const detail = findDetailSheet(sheets);
  if (!detail) throw new Error("「社員番号・資格コード・資格取得日」が並ぶ明細シートが見つかりません。");

  // ===== 区分マスター =====
  // 「資格名」列にコード付きの名前、「区分」列に区分が入っている。
  const groupByCode = new Map<string, string>();
  const groupSheet = findGroupSheet(sheets, detail);
  if (groupSheet) {
    const heads = (groupSheet.rows[0] ?? []).map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
    const cName = heads.indexOf("資格名");
    const cGroup = heads.indexOf("区分");
    for (let i = 1; i < groupSheet.rows.length; i++) {
      const row = groupSheet.rows[i];
      const raw = (row[cName] ?? "").trim();
      const group = (row[cGroup] ?? "").trim();
      if (!raw || !group) continue;
      groupByCode.set(splitQualificationCode(raw).code, group);
    }
  }

  // ===== 明細を読む =====
  const heads = detail.rows[0].map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
  const col = (label: string) => heads.indexOf(label.replace(/[\s　\n]/g, ""));
  const cEmp = col("社員番号");
  const cQual = col("資格コード");
  const cAcq = col("資格取得日");
  const cCert = col("資格認定日");
  const cApply = col("適用開始日");
  const cRole = col("資格取得番号");
  const cExp = col("資格有効期限");
  const cPay = col("手当支給区分");

  interface Parsed {
    rowNo: number;
    employeeNo: string;
    code: string;
    name: string;
    acquiredOn: string | null;
    certifiedOn: string | null;
    appliedFrom: string | null;
    expiresOn: string | null;
    holderRole: string | null;
    allowancePaid: boolean | null;
  }
  const parsed: Parsed[] = [];
  /** コード → 名前（明細に出てきたもの。マスターに無いコードもここで拾う） */
  const nameByCode = new Map<string, string>();
  const countByCode = new Map<string, number>();

  for (let i = 1; i < detail.rows.length; i++) {
    const row = detail.rows[i];
    const employeeNo = (row[cEmp] ?? "").trim();
    const qual = (row[cQual] ?? "").trim();
    if (!employeeNo && !qual) continue;
    result.total++;
    const rowNo = i + 1;
    if (!employeeNo) {
      result.errors.push({ row: rowNo, employeeNo: "", message: "社員番号が空です。" });
      continue;
    }
    if (!qual) {
      result.errors.push({ row: rowNo, employeeNo, message: "資格コードが空です。" });
      continue;
    }
    const { code, name } = splitQualificationCode(qual);
    nameByCode.set(code, name);
    countByCode.set(code, (countByCode.get(code) ?? 0) + 1);
    parsed.push({
      rowNo,
      employeeNo,
      code,
      name,
      acquiredOn: toIsoSlash(row[cAcq]),
      certifiedOn: cCert >= 0 ? toIsoSlash(row[cCert]) : null,
      appliedFrom: cApply >= 0 ? toIsoSlash(row[cApply]) : null,
      expiresOn: cExp >= 0 ? toIsoSlash(row[cExp]) : null,
      holderRole: cRole >= 0 ? normalizeRole(row[cRole]) : null,
      allowancePaid: cPay >= 0 ? allowanceOf(row[cPay]) : null,
    });
  }

  // 区分マスターにしか無いコードも資格マスターに入れる（一覧として意味があるため）
  for (const code of groupByCode.keys()) {
    if (!nameByCode.has(code)) nameByCode.set(code, "");
  }
  if (groupSheet) {
    const heads2 = (groupSheet.rows[0] ?? []).map((c) => (c ?? "").replace(/[\s　\n]/g, ""));
    const cName = heads2.indexOf("資格名");
    for (let i = 1; i < groupSheet.rows.length; i++) {
      const raw = (groupSheet.rows[i][cName] ?? "").trim();
      if (!raw) continue;
      const { code, name } = splitQualificationCode(raw);
      if (!nameByCode.get(code)) nameByCode.set(code, name);
    }
  }

  // 区分が付かなかったコードを控える（画面に出して人が埋められるように）
  for (const [code, n] of countByCode) {
    if (!groupByCode.has(code)) {
      result.ungrouped.push({ code, name: nameByCode.get(code) ?? code, count: n });
    }
  }
  result.ungrouped.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // ===== 資格マスターを upsert =====
  const masterCodes = [...nameByCode.keys()];
  const CHUNK = 400;
  for (let start = 0; start < masterCodes.length; start += CHUNK) {
    const part = masterCodes.slice(start, start + CHUNK);
    const ret = await sql`
      INSERT INTO jinji_qualification_master (code, name, category, group_name, sort)
      SELECT code, nm, cat, NULLIF(grp, ''), 0
      FROM unnest(
        ${part}::text[],
        ${part.map((c) => nameByCode.get(c) || c)}::text[],
        ${part.map((c) => categoryOfGroup(groupByCode.get(c) ?? null))}::text[],
        ${part.map((c) => groupByCode.get(c) ?? "")}::text[]
      ) AS v(code, nm, cat, grp)
      ON CONFLICT (code) DO UPDATE
        SET name       = EXCLUDED.name,
            category   = EXCLUDED.category,
            group_name = EXCLUDED.group_name
      RETURNING (xmax = 0) AS created`;
    for (const r of ret as any[]) {
      if (r.created) result.mastersCreated++;
      else result.mastersUpdated++;
    }
  }

  // コード → マスターID
  const masterRows = await sql`SELECT id, code FROM jinji_qualification_master`;
  const masterIdByCode = new Map(
    (masterRows as any[]).map((r) => [r.code as string, r.id as string]),
  );

  // ===== 社員番号 → id（台帳に居ない人は取り込まない） =====
  const nos = [...new Set(parsed.map((p) => p.employeeNo))];
  const empRows = await sql`
    SELECT id, employee_no FROM jinji_employees WHERE employee_no = ANY(${nos}::text[])`;
  const idByNo = new Map((empRows as any[]).map((r) => [r.employee_no as string, r.id as string]));
  const missing = new Set<string>();
  const rows = parsed.filter((p) => {
    if (idByNo.has(p.employeeNo)) return true;
    missing.add(p.employeeNo);
    return false;
  });
  result.missing = [...missing].sort();

  // ===== 前回の取込ぶんを消してから入れ直す =====
  // 手で登録した行（source が NULL）は残す。
  const removed = await sql`DELETE FROM jinji_qualifications WHERE source = 'import' RETURNING id`;
  result.removed = removed.length;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const part = rows.slice(start, start + CHUNK);
    try {
      const ret = await sql`
        INSERT INTO jinji_qualifications
          (employee_id, master_id, code, name, category, acquired_on, certified_on,
           applied_from, expires_on, holder_role, allowance_paid, source)
        SELECT emp::uuid, NULLIF(mid, '')::uuid, code, nm, cat,
               NULLIF(acq, '')::date, NULLIF(cert, '')::date, NULLIF(app, '')::date,
               NULLIF(exp, '')::date, NULLIF(role, ''), pay, 'import'
        FROM unnest(
          ${part.map((p) => idByNo.get(p.employeeNo)!)}::text[],
          ${part.map((p) => masterIdByCode.get(p.code) ?? "")}::text[],
          ${part.map((p) => p.code)}::text[],
          ${part.map((p) => p.name || p.code)}::text[],
          ${part.map((p) => categoryOfGroup(groupByCode.get(p.code) ?? null))}::text[],
          ${part.map((p) => p.acquiredOn ?? "")}::text[],
          ${part.map((p) => p.certifiedOn ?? "")}::text[],
          ${part.map((p) => p.appliedFrom ?? "")}::text[],
          ${part.map((p) => p.expiresOn ?? "")}::text[],
          ${part.map((p) => p.holderRole ?? "")}::text[],
          ${part.map((p) => p.allowancePaid)}::boolean[]
        ) AS v(emp, mid, code, nm, cat, acq, cert, app, exp, role, pay)
        RETURNING id`;
      result.created += ret.length;
    } catch (e) {
      result.errors.push({
        row: part[0].rowNo,
        employeeNo: `${part[0].employeeNo}〜${part[part.length - 1].employeeNo}`,
        message: `${part.length} 件の取込に失敗: ${(e as Error).message}`,
      });
    }
  }

  return result;
}

/** 表示用に区分を丸めない名前を返すためのヘルパ（画面から使う）。 */
export function qualificationCategoryOf(group: string | null): QualificationCategory {
  return normalizeQualificationCategory(categoryOfGroup(group));
}

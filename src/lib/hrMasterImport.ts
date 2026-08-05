import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { XlsxSheet } from "./xlsx";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 人事マスタ（階層＋承認者のExcel）の取込。
 *
 * 実物は2シート:
 *  - 「階層」  … 組織コード２（本部）→ 部署 → 所属組織（8桁）と、階層の深さ(2〜4)。
 *               これが組織図の**正**になる。
 *  - 「承認者」… 社員ごとの 所属組織・職務名称・管理者（社員番号と氏名）。
 *               一般はその管理者、管理者の行にはその承認者が入っている。
 *
 * 分からない箇所は #N/A で届く。N/A は「未確定」なので**既存の値を消さない**。
 */

export interface HrMasterResult {
  org: {
    rootsCreated: number;
    groupsCreated: number;
    unitsCreated: number;
    renamed: number;
    moved: number;
  };
  employees: {
    total: number;
    created: number;
    updated: number;
    managersSet: number;
    managersUnknown: number;
  };
  errors: { sheet: string; row: number; message: string }[];
}

const isNA = (v: string | undefined): boolean => /^#?N\/?A$/i.test((v ?? "").trim());
const val = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  return !s || isNA(s) ? null : s;
};

/**
 * 組織名の表記ゆれを吸収して突き合わせるための正規化。
 * 半角カナ⇔全角（NFKC）・空白・小さいッの有無（ロジスティクス／ロジスティックス）を同一視する。
 */
export function normalizeOrgName(s: string): string {
  return s.normalize("NFKC").replace(/[\s　]+/g, "").replace(/[ッｯ]/g, "");
}

/** シートが「階層」「承認者」の組か。 */
export function looksLikeHrMaster(sheets: XlsxSheet[]): boolean {
  const hier = sheets.find((s) => findHeaderRow(s, ["組織コード２", "階層"]) >= 0);
  const appr = sheets.find((s) => findHeaderRow(s, ["社員番号", "管理者１"]) >= 0);
  return Boolean(hier && appr);
}

/** 指定の見出しをすべて含む行を探す。 */
function findHeaderRow(sheet: XlsxSheet, labels: string[], maxScan = 10): number {
  for (let i = 0; i < Math.min(sheet.rows.length, maxScan); i++) {
    const cells = sheet.rows[i].map((c) => (c ?? "").replace(/[\s　]+/g, ""));
    if (labels.every((l) => cells.includes(l))) return i;
  }
  return -1;
}

interface HierRow {
  rowNo: number;
  rootCode: string;
  rootName: string;
  deptCode: string | null;
  deptName: string | null;
  orgCode: string;
  orgName: string;
  level: number;
}

function parseHierarchy(sheet: XlsxSheet): HierRow[] {
  const h = findHeaderRow(sheet, ["組織コード２", "階層"]);
  const heads = sheet.rows[h].map((c) => (c ?? "").replace(/[\s　]+/g, ""));
  const col = (label: string) => heads.indexOf(label);
  const cRoot = col("組織コード２");
  const cRootName = col("組織名称漢字２");
  const cDept = col("部署コード");
  const cDeptName = col("部署名称");
  const cOrg = col("所属組織コード");
  const cOrgName = col("所属組織名称漢字");
  const cLevel = col("階層");

  const out: HierRow[] = [];
  for (let i = h + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const orgCode = val(r[cOrg]);
    const rootCode = val(r[cRoot]);
    if (!orgCode || !rootCode) continue;
    out.push({
      rowNo: i + 1,
      rootCode,
      rootName: val(r[cRootName]) ?? rootCode,
      deptCode: val(r[cDept]),
      deptName: val(r[cDeptName]),
      orgCode,
      orgName: val(r[cOrgName]) ?? orgCode,
      level: Number(val(r[cLevel]) ?? "3") || 3,
    });
  }
  return out;
}

/**
 * 「階層」シートから組織ツリーを組む。
 *
 * 作る形は 本部 → 部署（工場・部）→ 所属組織。階層4の組織（配送センター等）は
 * 同じ部署の階層3の組織が1つに定まるとき、その下へぶら下げる。
 * 部署コードが本部そのもの・N/A の行は本部直下に置く。
 *
 * 既存の組織は**名称と親だけ**を寄せ、コード・並び順・組織の長は保つ。冪等。
 */
export async function importOrgHierarchy(sheet: XlsxSheet): Promise<HrMasterResult["org"]> {
  await ensureSchema();
  const sql = getSql();
  const rows = parseHierarchy(sheet);
  const result = { rootsCreated: 0, groupsCreated: 0, unitsCreated: 0, renamed: 0, moved: 0 };

  const units = await sql`SELECT id, code, name, parent_id, dept_code, workplace_code FROM jinji_org_units`;
  const byCode = new Map(units.map((u: any) => [u.code as string, u]));
  const byId = new Map(units.map((u: any) => [u.id as string, u]));
  const rootOf = (u: any): any => {
    const seen = new Set<string>();
    let cur = u;
    while (cur.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const p = byId.get(cur.parent_id);
      if (!p) break;
      cur = p;
    }
    return cur;
  };

  // ===== 本部（組織コード２） =====
  const roots = new Map<string, string>();
  for (const r of rows) roots.set(r.rootCode, r.rootName);
  const rootIdByCode = new Map<string, string>();
  for (const [code, name] of roots) {
    const existing = byCode.get(code);
    if (existing) {
      rootIdByCode.set(code, existing.id as string);
      if ((existing.name as string) !== name) {
        await sql`UPDATE jinji_org_units SET name = ${name}, updated_at = NOW() WHERE id = ${existing.id}`;
        result.renamed++;
      }
    } else {
      const ins = await sql`
        INSERT INTO jinji_org_units (code, name, kind, parent_id)
        VALUES (${code}, ${name}, 'honbu', NULL) RETURNING id`;
      rootIdByCode.set(code, ins[0].id as string);
      result.rootsCreated++;
    }
  }

  // ===== 部署（工場・部） =====
  // 部署コードで束ね、名称は最頻の表記を使う（ロジスティクス／ロジスティックスのゆれ対策）。
  // 既存の同名（正規化して比較）組織が同じ本部の下にあればそれを使う。
  interface Dept {
    code: string;
    rootCode: string;
    names: Map<string, number>;
  }
  const depts = new Map<string, Dept>();
  for (const r of rows) {
    if (!r.deptCode || !r.deptName || r.deptCode === r.rootCode) continue;
    const d = depts.get(r.deptCode) ?? { code: r.deptCode, rootCode: r.rootCode, names: new Map() };
    d.names.set(r.deptName, (d.names.get(r.deptName) ?? 0) + 1);
    depts.set(r.deptCode, d);
  }
  const groupIdByDeptCode = new Map<string, string>();
  for (const d of depts.values()) {
    const name = [...d.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const rootId = rootIdByCode.get(d.rootCode)!;
    const norm = normalizeOrgName(name);
    const existing = units.find(
      (u: any) =>
        normalizeOrgName(u.name as string) === norm &&
        rootOf(u).id === rootId &&
        // 部署そのものを探す（8桁の所属組織と同名のときは親を持つ方＝葉ではない方を優先しない。
        // まずは葉コード一致を除いた候補から探す）
        !rows.some((r) => r.orgCode === (u.code as string)),
    );
    if (existing) {
      groupIdByDeptCode.set(d.code, existing.id as string);
      if ((existing.name as string) !== name) {
        await sql`UPDATE jinji_org_units SET name = ${name}, updated_at = NOW() WHERE id = ${existing.id}`;
        result.renamed++;
      }
      if (existing.parent_id !== rootId) {
        await sql`UPDATE jinji_org_units SET parent_id = ${rootId}, updated_at = NOW() WHERE id = ${existing.id}`;
        result.moved++;
      }
      // 部署コードは表示用の識別子。変わっていたら黙って寄せる（件数には数えない）
      if ((existing.dept_code as string | null) !== d.code) {
        await sql`UPDATE jinji_org_units SET dept_code = ${d.code}, updated_at = NOW() WHERE id = ${existing.id}`;
        existing.dept_code = d.code;
      }
    } else {
      const code = `AUTO-${name}`;
      const ins = await sql`
        INSERT INTO jinji_org_units (code, name, kind, parent_id, dept_code)
        VALUES (${code}, ${name}, ${name.endsWith("工場") ? "factory" : "bu"}, ${rootId}, ${d.code})
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, dept_code = EXCLUDED.dept_code
        RETURNING id, (xmax = 0) AS created`;
      groupIdByDeptCode.set(d.code, ins[0].id as string);
      if (ins[0].created) result.groupsCreated++;
    }
  }

  // ===== 所属組織（8桁の葉) =====
  // 階層4の親候補: 同じ部署の階層3が1つだけならそれ
  const level3ByDept = new Map<string, HierRow[]>();
  for (const r of rows) {
    if (r.level === 3 && r.deptCode) {
      const list = level3ByDept.get(r.deptCode) ?? [];
      list.push(r);
      level3ByDept.set(r.deptCode, list);
    }
  }

  // 工場の「安全推進工場長室」。工場ではこれを階層3に置き、他の職場は
  // その下（階層4）へぶら下げる（工場長・工場長代理・工場長付は工場直下のまま）。
  const isFactoryDept = new Map<string, boolean>();
  for (const d of depts.values()) {
    const name = [...d.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    isFactoryDept.set(d.code, name.endsWith("工場"));
  }
  const safetyRoomByDept = new Map<string, HierRow>();
  for (const r of rows) {
    if (r.deptCode && isFactoryDept.get(r.deptCode) && /安全推進工場長室/.test(r.orgName)) {
      safetyRoomByDept.set(r.deptCode, r);
    }
  }
  const isFactoryHeadUnit = (name: string) => /工場長(付|代理)?$/.test(name.replace(/[\s　]+/g, ""));

  // 階層の浅い順・安全推進工場長室を先に upsert する（他の職場の親になるため）
  const newLeafByCode = new Map<string, { id: string }>();

  const parentOf = (r: HierRow): string => {
    const rootId = rootIdByCode.get(r.rootCode)!;
    if (!r.deptCode || r.deptCode === r.rootCode) return rootId;
    const group = groupIdByDeptCode.get(r.deptCode);
    if (!group) return rootId;
    if (r.level >= 4) {
      const l3 = level3ByDept.get(r.deptCode) ?? [];
      if (l3.length === 1) {
        const parent: any = byCode.get(l3[0].orgCode) ?? newLeafByCode.get(l3[0].orgCode);
        if (parent) return parent.id as string;
      }
    }
    // 工場の職場は安全推進工場長室の下（安全推進が階層3、他が階層4）。
    // 工場長・工場長代理・工場長付は工場直下に残す（組織図で工場の枠に統合するため）。
    const safety = safetyRoomByDept.get(r.deptCode);
    if (
      safety &&
      safety.orgCode !== r.orgCode &&
      !isFactoryHeadUnit(r.orgName)
    ) {
      const parent: any = byCode.get(safety.orgCode) ?? newLeafByCode.get(safety.orgCode);
      if (parent) return parent.id as string;
    }
    return group;
  };

  const isSafety = (r: HierRow) => safetyRoomByDept.get(r.deptCode ?? "")?.orgCode === r.orgCode;
  const ordered = [...rows].sort(
    (a, b) => a.level - b.level || (isSafety(b) ? 1 : 0) - (isSafety(a) ? 1 : 0),
  );
  for (const r of ordered) {
    const existing = byCode.get(r.orgCode) ?? newLeafByCode.get(r.orgCode);
    const parentId = parentOf(r);
    // 職場コード＝所属組織コード（8桁）。部署コードは #N/A なら既存を残す
    const wantDept = r.deptCode ?? null;
    if (existing) {
      const u: any = existing;
      const rename = u.name !== undefined && (u.name as string) !== r.orgName;
      // 部署が #N/A（未確定）の行は既存の親を動かさない。
      // 名称ルールの自動整理が組んだ階層（調達部の下など）を消さないため。
      const reparent =
        r.deptCode !== null && u.parent_id !== undefined && u.parent_id !== parentId;
      const recode =
        u.workplace_code !== undefined &&
        ((u.workplace_code as string | null) !== r.orgCode ||
          (wantDept !== null && (u.dept_code as string | null) !== wantDept));
      if (rename || reparent || recode) {
        const nextParent = reparent ? parentId : (u.parent_id ?? null);
        const nextDept = wantDept ?? ((u.dept_code as string | null) ?? null);
        await sql`
          UPDATE jinji_org_units
          SET name = ${r.orgName}, parent_id = ${nextParent},
              dept_code = ${nextDept}, workplace_code = ${r.orgCode}, updated_at = NOW()
          WHERE id = ${u.id}`;
        if (rename) result.renamed++;
        if (reparent) result.moved++;
        u.name = r.orgName;
        u.parent_id = nextParent;
        u.dept_code = nextDept;
        u.workplace_code = r.orgCode;
      }
    } else {
      const kind = r.orgName.includes("工場長") ? "workplace" : r.level >= 4 ? "kakari" : "workplace";
      const ins = await sql`
        INSERT INTO jinji_org_units (code, name, kind, parent_id, dept_code, workplace_code)
        VALUES (${r.orgCode}, ${r.orgName}, ${kind}, ${parentId}, ${wantDept}, ${r.orgCode})
        ON CONFLICT (code) DO NOTHING
        RETURNING id`;
      if (ins.length > 0) {
        newLeafByCode.set(r.orgCode, { id: ins[0].id as string });
        result.unitsCreated++;
      }
    }
  }
  return result;
}

interface ApproverRow {
  rowNo: number;
  orgCode: string | null;
  employeeNo: string;
  name: string;
  duty: string | null;
  managerNo: string | null;
  managerName: string | null;
}

function parseApprovers(sheet: XlsxSheet): ApproverRow[] {
  const h = findHeaderRow(sheet, ["社員番号", "管理者１"]);
  const heads = sheet.rows[h].map((c) => (c ?? "").replace(/[\s　]+/g, ""));
  const col = (label: string) => heads.indexOf(label);
  const cOrg = col("所属組織コード");
  const cNo = col("社員番号");
  const cName = col("ビジネスネーム氏名");
  const cDuty = col("職務名称");
  const cMgrNo = col("管理者１");
  const cMgrName = col("管理者２");

  const out: ApproverRow[] = [];
  for (let i = h + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const employeeNo = val(r[cNo]);
    if (!employeeNo) continue;
    const managerNo = val(r[cMgrNo]);
    out.push({
      rowNo: i + 1,
      orgCode: val(r[cOrg]),
      employeeNo,
      name: val(r[cName]) ?? employeeNo,
      duty: val(r[cDuty]),
      managerNo: managerNo && /^\d+$/.test(managerNo) ? managerNo : null,
      managerName: val(r[cMgrName]),
    });
  }
  return out;
}

/**
 * 「承認者」シートから社員の 所属・職務・管理者（承認者）を反映する。
 *
 * - 社員番号をキーに upsert。台帳に居ない人は名前・所属だけで新規登録する
 * - 所属・職務・管理者は**値が読めた行だけ**更新する（N/A は既存を残す）
 * - 名簿由来の他の項目（カナ・性別・生年月日など）は触らない
 */
export async function importApprovers(sheet: XlsxSheet): Promise<HrMasterResult["employees"]> {
  await ensureSchema();
  const sql = getSql();
  const rows = parseApprovers(sheet);
  const result = { total: rows.length, created: 0, updated: 0, managersSet: 0, managersUnknown: 0 };

  const orgRows = await sql`SELECT id, code FROM jinji_org_units`;
  const orgIdByCode = new Map(orgRows.map((r: any) => [r.code as string, r.id as string]));

  for (const r of rows) {
    if (r.managerNo === null) result.managersUnknown++;
    else result.managersSet++;
  }

  const CHUNK = 500;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const part = rows.slice(start, start + CHUNK);
    const ret = await sql`
      INSERT INTO jinji_employees
        (employee_no, name, org_unit_id, duty_name, manager_employee_no, manager_name, status)
      SELECT *, 'active' FROM unnest(
        ${part.map((x) => x.employeeNo)}::text[],
        ${part.map((x) => x.name)}::text[],
        ${part.map((x) => (x.orgCode ? orgIdByCode.get(x.orgCode) ?? null : null))}::uuid[],
        ${part.map((x) => x.duty)}::text[],
        ${part.map((x) => x.managerNo)}::text[],
        ${part.map((x) => x.managerName)}::text[]
      )
      ON CONFLICT (employee_no) DO UPDATE SET
        org_unit_id         = COALESCE(EXCLUDED.org_unit_id, jinji_employees.org_unit_id),
        duty_name           = COALESCE(EXCLUDED.duty_name, jinji_employees.duty_name),
        manager_employee_no = COALESCE(EXCLUDED.manager_employee_no, jinji_employees.manager_employee_no),
        manager_name        = COALESCE(EXCLUDED.manager_name, jinji_employees.manager_name),
        updated_at          = NOW()
      RETURNING (xmax = 0) AS created`;
    for (const row of ret) {
      if (row.created) result.created++;
      else result.updated++;
    }
  }
  return result;
}

/** 階層＋承認者の2シートをまとめて取り込む。 */
export async function importHrMaster(sheets: XlsxSheet[]): Promise<HrMasterResult> {
  const errors: HrMasterResult["errors"] = [];
  const hier = sheets.find((s) => findHeaderRow(s, ["組織コード２", "階層"]) >= 0);
  const appr = sheets.find((s) => findHeaderRow(s, ["社員番号", "管理者１"]) >= 0);
  if (!hier || !appr) throw new Error("「階層」「承認者」のシートが見つかりません。");

  const org = await importOrgHierarchy(hier);
  const employees = await importApprovers(appr);
  return { org, employees, errors };
}

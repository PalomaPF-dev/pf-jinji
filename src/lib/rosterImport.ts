import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { Gender } from "./types";

/**
 * 人事システムが出力する**社員名簿**の取込。
 *
 * 従来のCSV取込（EMPLOYEE_CSV_HEADERS）とは列がまったく違うため、別経路にしてある。
 * 名簿は次の点で「人が作ったCSV」と性質が違う。
 *
 * 1. **列は名簿側の名前で来る**（氏名ではなく「ビジネスネーム氏名」など）。
 *    見出しの別名表で吸収する。
 * 2. **組織は8桁コードで来る**。202件あり、事前に組織図へ登録しておくのは現実的でないので、
 *    取込のときに組織ツリーごと作る（組織コード２ → 所属組織コード の2階層）。
 *    この8桁コードは異動申請書 J-426(9) の「部門コード（8桁）」と同じもの。
 * 3. **名簿に無い項目がある**（生年月日・入社日・連絡先・在籍状態）。
 *    ここが最重要で、**名簿に無い列は既存の値を消さない**。
 *    全項目を上書きする作りにすると、名簿を取り込むたびに手入力した情報が消える。
 */

/** 見出しの別名。左が正、右が名簿側の表記。前後の空白は呼び出し側で除去済み。 */
const ALIASES: Record<string, string[]> = {
  employeeNo: ["社員番号", "社員ｺｰﾄﾞ", "社員コード"],
  name: ["ビジネスネーム氏名", "氏名", "名前"],
  nameKana: ["ビジネスネームカナ氏名", "カナ", "カナ氏名", "フリガナ"],
  gender: ["性別"],
  employmentType: ["雇用体系名称", "雇用体系", "雇用区分"],
  employmentTypeCode: ["雇用体系"],
  positionName: ["役職名称", "役職"],
  positionCode: ["役職コード"],
  dutyName: ["職務名称", "職務"],
  dutyCode: ["職務コード"],
  grade: ["職務等級名称", "等級", "職務等級"],
  gradeCode: ["職務等級コード"],
  jobCategory: ["職種名称", "職種"],
  jobCategoryCode: ["職種コード"],
  jobGroup: ["職群名称", "職群"],
  jobGroupCode: ["職群コード"],
  payClass: ["給与支給区分名称"],
  payClassCode: ["給与支給区分"],
  employeeClass: ["社員区分名称"],
  employeeClassCode: ["社員区分"],
  positionClass: ["職位名称"],
  positionClassCode: ["職位コード"],
  payrollOrgCode: ["給与組織コード"],
  payrollOrgName: ["給与組織名称漢字", "給与組織名称"],
  accountOrgCode: ["会計組織コード"],
  accountOrgName: ["会計組織名称漢字", "会計組織名称"],
  parentOrgCode: ["組織コード２", "組織コード2"],
  parentOrgName: ["組織名称漢字２", "組織名称漢字2", "組織名称２"],
  orgCode: ["所属組織コード"],
  orgName: ["所属組織名称漢字", "所属組織名称"],
};

/** 名簿の1行から、別名表を使って値を取り出す。 */
function pick(rec: Record<string, string>, key: keyof typeof ALIASES): string {
  for (const alias of ALIASES[key]) {
    const v = rec[alias];
    if (v !== undefined && v !== "") return v.trim();
  }
  return "";
}

const GENDER: Record<string, Gender> = { 男性: "male", 男: "male", 女性: "female", 女: "female" };

export interface RosterImportOptions {
  /** 取り込む上位組織名（組織名称漢字２）。空なら絞り込まない */
  parentOrgNames?: string[];
  /** 名簿に載っていない在籍者を退職として扱うか（既定は触らない） */
  markMissingAsRetired?: boolean;
}

export interface RosterImportResult {
  total: number;
  created: number;
  updated: number;
  /** 新しく作った組織の数（上位・配下の合計） */
  orgsCreated: number;
  skipped: number;
  errors: { row: number; employeeNo: string; message: string }[];
}

/** 名簿に必要な見出しが揃っているか（取込前の判定に使う）。 */
export function looksLikeRoster(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.replace(/[\s　]+/g, "")));
  return ALIASES.employeeNo.some((a) => set.has(a)) && ALIASES.orgCode.some((a) => set.has(a));
}

/**
 * 名簿を取り込む。
 *
 * 組織は「組織コード２（4桁）→ 所属組織コード（8桁）」の2階層で作る。
 * すでに同じコードの組織があれば**名称だけ**を最新に寄せ、人事側で組み替えた
 * 親子関係・並び順・組織の長は壊さない（ポータル同期と同じ方針）。
 */
export async function importRoster(
  records: Record<string, string>[],
  options: RosterImportOptions = {},
): Promise<RosterImportResult> {
  await ensureSchema();
  const sql = getSql();

  const result: RosterImportResult = {
    total: records.length,
    created: 0,
    updated: 0,
    orgsCreated: 0,
    skipped: 0,
    errors: [],
  };

  const filter = (options.parentOrgNames ?? []).filter((s) => s.trim());
  const rows = filter.length
    ? records.filter((r) => filter.includes(pick(r, "parentOrgName")))
    : records;
  result.skipped = records.length - rows.length;

  // ===== 1. 組織を先に作る（人ごとに引くと202回の往復になるため一括） =====
  const orgRows = await sql`SELECT id, code, name FROM jinji_org_units`;
  const orgIdByCode = new Map(orgRows.map((r) => [r.code as string, r.id as string]));
  const orgNameByCode = new Map(orgRows.map((r) => [r.code as string, r.name as string]));

  // 上位組織（組織コード２）
  const parents = new Map<string, string>();
  const children = new Map<string, { name: string; parentCode: string }>();
  for (const r of rows) {
    const pc = pick(r, "parentOrgCode");
    const pn = pick(r, "parentOrgName");
    if (pc && pn) parents.set(pc, pn);
    const oc = pick(r, "orgCode");
    const on = pick(r, "orgName");
    if (oc) children.set(oc, { name: on || oc, parentCode: pc });
  }

  const upsertOrg = async (code: string, name: string, kind: string, parentId: string | null) => {
    const existing = orgIdByCode.get(code);
    if (existing) {
      // 名称だけ寄せる。階層・並び順・組織の長は人事側の設定を尊重して触らない
      if (orgNameByCode.get(code) !== name) {
        await sql`UPDATE jinji_org_units SET name = ${name} WHERE id = ${existing}`;
        orgNameByCode.set(code, name);
      }
      return existing;
    }
    const ins = await sql`
      INSERT INTO jinji_org_units (code, name, kind, parent_id)
      VALUES (${code}, ${name}, ${kind}, ${parentId})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    const id = ins[0].id as string;
    orgIdByCode.set(code, id);
    orgNameByCode.set(code, name);
    result.orgsCreated++;
    return id;
  };

  const parentIdByCode = new Map<string, string>();
  for (const [code, name] of parents) {
    parentIdByCode.set(code, await upsertOrg(code, name, "honbu", null));
  }
  for (const [code, info] of children) {
    const parentId = info.parentCode ? parentIdByCode.get(info.parentCode) ?? null : null;
    await upsertOrg(code, info.name, "ka", parentId);
  }

  // ===== 2. 社員を1件ずつ upsert =====
  for (let i = 0; i < rows.length; i++) {
    const rec = rows[i];
    const rowNo = i + 2; // ヘッダ行が1行目
    const employeeNo = pick(rec, "employeeNo");
    try {
      if (!employeeNo) {
        result.errors.push({ row: rowNo, employeeNo: "", message: "社員番号がありません。" });
        continue;
      }
      const name = pick(rec, "name");
      if (!name) {
        result.errors.push({ row: rowNo, employeeNo, message: "氏名がありません。" });
        continue;
      }
      const orgCode = pick(rec, "orgCode");
      const orgUnitId = orgCode ? orgIdByCode.get(orgCode) ?? null : null;
      const genderRaw = pick(rec, "gender");
      const gender = genderRaw ? GENDER[genderRaw] ?? null : null;

      // 名簿に無い列（生年月日・入社日・連絡先・在籍状態）はこのUPDATEに含めない。
      // 含めると取込のたびに手入力した情報が消える。
      const updated = await sql`
        UPDATE jinji_employees SET
          name = ${name},
          name_kana = COALESCE(NULLIF(${pick(rec, "nameKana")}, ''), name_kana),
          gender = COALESCE(${gender}, gender),
          employment_type = COALESCE(NULLIF(${pick(rec, "employmentType")}, ''), employment_type),
          org_unit_id = COALESCE(${orgUnitId}::uuid, org_unit_id),
          position_name = ${pick(rec, "positionName") || null},
          position_code = ${pick(rec, "positionCode") || null},
          duty_name = ${pick(rec, "dutyName") || null},
          duty_code = ${pick(rec, "dutyCode") || null},
          grade = ${pick(rec, "grade") || null},
          grade_code = ${pick(rec, "gradeCode") || null},
          job_category = ${pick(rec, "jobCategory") || null},
          job_category_code = ${pick(rec, "jobCategoryCode") || null},
          job_group = ${pick(rec, "jobGroup") || null},
          job_group_code = ${pick(rec, "jobGroupCode") || null},
          pay_class = ${pick(rec, "payClass") || null},
          pay_class_code = ${pick(rec, "payClassCode") || null},
          employee_class = ${pick(rec, "employeeClass") || null},
          employee_class_code = ${pick(rec, "employeeClassCode") || null},
          position_class = ${pick(rec, "positionClass") || null},
          position_class_code = ${pick(rec, "positionClassCode") || null},
          payroll_org_code = ${pick(rec, "payrollOrgCode") || null},
          payroll_org_name = ${pick(rec, "payrollOrgName") || null},
          account_org_code = ${pick(rec, "accountOrgCode") || null},
          account_org_name = ${pick(rec, "accountOrgName") || null},
          updated_at = NOW()
        WHERE employee_no = ${employeeNo}
        RETURNING id`;

      if (updated.length > 0) {
        result.updated++;
        continue;
      }

      await sql`
        INSERT INTO jinji_employees
          (employee_no, name, name_kana, gender, employment_type, org_unit_id,
           position_name, position_code, duty_name, duty_code, grade, grade_code,
           job_category, job_category_code, job_group, job_group_code,
           pay_class, pay_class_code, employee_class, employee_class_code,
           position_class, position_class_code,
           payroll_org_code, payroll_org_name, account_org_code, account_org_name,
           status)
        VALUES
          (${employeeNo}, ${name}, ${pick(rec, "nameKana") || null}, ${gender},
           ${pick(rec, "employmentType") || null}, ${orgUnitId},
           ${pick(rec, "positionName") || null}, ${pick(rec, "positionCode") || null},
           ${pick(rec, "dutyName") || null}, ${pick(rec, "dutyCode") || null},
           ${pick(rec, "grade") || null}, ${pick(rec, "gradeCode") || null},
           ${pick(rec, "jobCategory") || null}, ${pick(rec, "jobCategoryCode") || null},
           ${pick(rec, "jobGroup") || null}, ${pick(rec, "jobGroupCode") || null},
           ${pick(rec, "payClass") || null}, ${pick(rec, "payClassCode") || null},
           ${pick(rec, "employeeClass") || null}, ${pick(rec, "employeeClassCode") || null},
           ${pick(rec, "positionClass") || null}, ${pick(rec, "positionClassCode") || null},
           ${pick(rec, "payrollOrgCode") || null}, ${pick(rec, "payrollOrgName") || null},
           ${pick(rec, "accountOrgCode") || null}, ${pick(rec, "accountOrgName") || null},
           'active')`;
      result.created++;
    } catch (e) {
      result.errors.push({ row: rowNo, employeeNo, message: (e as Error).message });
    }
  }

  return result;
}

/** 名簿に含まれる上位組織（組織名称漢字２）の一覧と件数。取込前の確認に使う。 */
export function parentOrgSummary(records: Record<string, string>[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const n = pick(r, "parentOrgName") || "（未設定）";
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

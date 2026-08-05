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

  // ===== 1. 組織 =====
  // 1件ずつ INSERT すると 202 回の往復になる。unnest で1文にまとめる。
  const orgRows = await sql`SELECT id, code FROM jinji_org_units`;
  const orgIdByCode = new Map(orgRows.map((r) => [r.code as string, r.id as string]));

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

  /**
   * 組織をまとめて upsert する。
   * 既存の組織は**名称だけ**を寄せ、親子関係・並び順・組織の長は触らない
   * （人事側で組み替えた階層を名簿の取込で壊さないため）。
   */
  const upsertOrgs = async (
    entries: { code: string; name: string; kind: string; parentId: string | null }[],
  ) => {
    if (entries.length === 0) return;
    const inserted = await sql`
      INSERT INTO jinji_org_units (code, name, kind, parent_id)
      SELECT * FROM unnest(
        ${entries.map((e) => e.code)}::text[],
        ${entries.map((e) => e.name)}::text[],
        ${entries.map((e) => e.kind)}::text[],
        ${entries.map((e) => e.parentId)}::uuid[]
      )
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code, (xmax = 0) AS created`;
    for (const r of inserted) {
      orgIdByCode.set(r.code as string, r.id as string);
      if (r.created) result.orgsCreated++;
    }
  };

  await upsertOrgs(
    [...parents].map(([code, name]) => ({ code, name, kind: "honbu", parentId: null })),
  );
  await upsertOrgs(
    [...children].map(([code, info]) => ({
      code,
      name: info.name,
      kind: "ka",
      parentId: info.parentCode ? orgIdByCode.get(info.parentCode) ?? null : null,
    })),
  );

  // ===== 2. 社員 =====
  // 1件ずつ UPDATE/INSERT すると人数ぶんの往復になる（1685件で約1700回）。
  // ローカルDBなら数秒でも、リモートDBでは1往復が数十msかかるため数分になる。
  // unnest + ON CONFLICT で1文にまとめ、往復を人数に依存させない。
  type Row = Record<string, string | null>;
  const valid: Row[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rec = rows[i];
    const rowNo = i + 2; // ヘッダ行が1行目
    const employeeNo = pick(rec, "employeeNo");
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
    const genderRaw = pick(rec, "gender");
    const or = (k: keyof typeof ALIASES) => pick(rec, k) || null;
    valid.push({
      employeeNo,
      name,
      nameKana: or("nameKana"),
      gender: genderRaw ? GENDER[genderRaw] ?? null : null,
      employmentType: or("employmentType"),
      orgUnitId: orgCode ? orgIdByCode.get(orgCode) ?? null : null,
      positionName: or("positionName"),
      positionCode: or("positionCode"),
      dutyName: or("dutyName"),
      dutyCode: or("dutyCode"),
      grade: or("grade"),
      gradeCode: or("gradeCode"),
      jobCategory: or("jobCategory"),
      jobCategoryCode: or("jobCategoryCode"),
      jobGroup: or("jobGroup"),
      jobGroupCode: or("jobGroupCode"),
      payClass: or("payClass"),
      payClassCode: or("payClassCode"),
      employeeClass: or("employeeClass"),
      employeeClassCode: or("employeeClassCode"),
      positionClass: or("positionClass"),
      positionClassCode: or("positionClassCode"),
      payrollOrgCode: or("payrollOrgCode"),
      payrollOrgName: or("payrollOrgName"),
      accountOrgCode: or("accountOrgCode"),
      accountOrgName: or("accountOrgName"),
    });
  }

  // 1文に載せる件数の上限。1万件級の名簿でも1文が大きくなりすぎないよう分割する。
  const CHUNK = 500;
  for (let start = 0; start < valid.length; start += CHUNK) {
    const part = valid.slice(start, start + CHUNK);
    const c = (k: string) => part.map((v) => v[k]);
    try {
      // 名簿に無い列（生年月日・入社日・連絡先・在籍状態）は DO UPDATE の対象にしない。
      // 対象にすると、取り込むたびに手入力した情報が消える。
      // status は INSERT のときだけ 'active' が入り、既存行では触られない。
      const ret = await sql`
        INSERT INTO jinji_employees
          (employee_no, name, name_kana, gender, employment_type, org_unit_id,
           position_name, position_code, duty_name, duty_code, grade, grade_code,
           job_category, job_category_code, job_group, job_group_code,
           pay_class, pay_class_code, employee_class, employee_class_code,
           position_class, position_class_code,
           payroll_org_code, payroll_org_name, account_org_code, account_org_name, status)
        SELECT *, 'active' FROM unnest(
          ${c("employeeNo")}::text[], ${c("name")}::text[], ${c("nameKana")}::text[],
          ${c("gender")}::text[], ${c("employmentType")}::text[], ${c("orgUnitId")}::uuid[],
          ${c("positionName")}::text[], ${c("positionCode")}::text[],
          ${c("dutyName")}::text[], ${c("dutyCode")}::text[],
          ${c("grade")}::text[], ${c("gradeCode")}::text[],
          ${c("jobCategory")}::text[], ${c("jobCategoryCode")}::text[],
          ${c("jobGroup")}::text[], ${c("jobGroupCode")}::text[],
          ${c("payClass")}::text[], ${c("payClassCode")}::text[],
          ${c("employeeClass")}::text[], ${c("employeeClassCode")}::text[],
          ${c("positionClass")}::text[], ${c("positionClassCode")}::text[],
          ${c("payrollOrgCode")}::text[], ${c("payrollOrgName")}::text[],
          ${c("accountOrgCode")}::text[], ${c("accountOrgName")}::text[]
        )
        ON CONFLICT (employee_no) DO UPDATE SET
          name                = EXCLUDED.name,
          name_kana           = COALESCE(EXCLUDED.name_kana, jinji_employees.name_kana),
          gender              = COALESCE(EXCLUDED.gender, jinji_employees.gender),
          employment_type     = COALESCE(EXCLUDED.employment_type, jinji_employees.employment_type),
          org_unit_id         = COALESCE(EXCLUDED.org_unit_id, jinji_employees.org_unit_id),
          position_name       = EXCLUDED.position_name,
          position_code       = EXCLUDED.position_code,
          duty_name           = EXCLUDED.duty_name,
          duty_code           = EXCLUDED.duty_code,
          grade               = EXCLUDED.grade,
          grade_code          = EXCLUDED.grade_code,
          job_category        = EXCLUDED.job_category,
          job_category_code   = EXCLUDED.job_category_code,
          job_group           = EXCLUDED.job_group,
          job_group_code      = EXCLUDED.job_group_code,
          pay_class           = EXCLUDED.pay_class,
          pay_class_code      = EXCLUDED.pay_class_code,
          employee_class      = EXCLUDED.employee_class,
          employee_class_code = EXCLUDED.employee_class_code,
          position_class      = EXCLUDED.position_class,
          position_class_code = EXCLUDED.position_class_code,
          payroll_org_code    = EXCLUDED.payroll_org_code,
          payroll_org_name    = EXCLUDED.payroll_org_name,
          account_org_code    = EXCLUDED.account_org_code,
          account_org_name    = EXCLUDED.account_org_name,
          updated_at          = NOW()
        RETURNING (xmax = 0) AS created`;
      for (const r of ret) {
        if (r.created) result.created++;
        else result.updated++;
      }
    } catch (e) {
      // 1文で流すため、失敗すると塊ごと落ちる。どこで落ちたか分かるよう行範囲を出す。
      result.errors.push({
        row: start + 2,
        employeeNo: `${part[0]?.employeeNo ?? ""}〜${part[part.length - 1]?.employeeNo ?? ""}`,
        message: `${part.length} 件の取込に失敗しました: ${(e as Error).message}`,
      });
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

import { getSql } from "./neon";
import { ensureAuthSchema } from "./authDb";
import { ensurePasswordResetSchema } from "./passwordReset";
import { applyLeaveByOrgName } from "./leaveOrg";
import { applyChotatsuStructure } from "./orgFixes";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DDL を実行するが、「既に存在する」系のエラーは無視する。
 * Postgres の CREATE INDEX/TABLE IF NOT EXISTS は同時実行に対して安全ではなく、
 * 複数リクエストが初回に同時に走ると pg_class のユニーク制約違反(23505/42P07/42710)で
 * 失敗しうる。冪等な初期化として、これらは握り潰す。
 */
async function safeDdl(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e: any) {
    const code = e?.code ?? e?.sourceError?.code;
    // 42P07: duplicate_table, 42710: duplicate_object, 23505: unique_violation(pg_catalog)
    if (code === "42P07" || code === "42710" || code === "23505") return;
    throw e;
  }
}

let schemaReady: Promise<void> | null = null;

/**
 * スキーマの版。**DDL を1つでも足したり変えたりしたら必ず上げること。**
 *
 * 上げ忘れると、新しい列やテーブルが本番に作られないまま
 * 「column ... does not exist」で落ちる。気づいたらこの数字を上げれば直る。
 */
const SCHEMA_VERSION = 12;

/**
 * すでに最新版まで作成済みかを、1回の問い合わせで確かめる。
 *
 * DDL は 90 文ある。CREATE TABLE IF NOT EXISTS は「既にある」なら安いが、
 * **1文ごとにDBへの往復が発生する**。ローカルDBなら往復1msで誤差だが、
 * 本番の Neon は HTTP 越しで1往復が数十msあり、サーバーレスのコールドスタートの
 * たびに 90 往復＝数秒を画面表示の前に払うことになる。
 * 版を1行読むだけで済ませ、初回とDDL変更時だけ全部を流す。
 */
async function schemaUpToDate(): Promise<boolean> {
  try {
    const sql = getSql();
    const rows = await sql`SELECT value FROM jinji_meta WHERE key = 'schema_version' LIMIT 1`;
    return Number(rows[0]?.value ?? 0) >= SCHEMA_VERSION;
  } catch {
    // テーブルがまだ無い（初回）。この後 DDL を流す
    return false;
  }
}

async function recordSchemaVersion(): Promise<void> {
  const sql = getSql();
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  await sql`
    INSERT INTO jinji_meta (key, value) VALUES ('schema_version', ${String(SCHEMA_VERSION)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/**
 * PF人事管理のドメインテーブルを冪等に作成する。
 *
 * - jinji_admins            … 利用許可名簿（このアプリを使える社員番号）
 * - jinji_org_units         … 組織ツリー（本部→部→課→係。ポータル部署マスタと突合）
 * - jinji_employees         … 人事マスター本体
 * - jinji_transfers         … 異動申請書ヘッダ（指定帳票 J-426(9)）
 * - jinji_transfer_approvals… 異動申請の承認欄（捺印枠）
 * - jinji_reemployments / jinji_reemployment_approvals … 継続雇用申請書（指定帳票 J-456）
 * - jinji_evaluation_items  … 人事考課の項目マスター
 * - jinji_evaluations       … 人事考課
 * - jinji_salaries          … 基本給与（履歴型）
 * - jinji_qualification_master / jinji_qualifications … 資格マスターと保有資格
 * - jinji_audit_logs        … 監査ログ（給与・考課は閲覧も記録する）
 * - jinji_counters          … 異動申請番号の年度連番
 *
 * 認証テーブル（companies/users/password_reset_tokens）も同時に用意する。
 * 同一プロセス内の同時呼び出しは1回の実行に集約（共有プロミス）。失敗時は次回再試行できるよう解除。
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = buildSchema().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function buildSchema(): Promise<void> {
  const sql = getSql();

  // 作成済みなら DDL は流さない（1往復で済ませる）。
  // 初期owner の自動登録だけは環境変数を見て毎回試すが、これは1文なので安い。
  if (await schemaUpToDate()) {
    await bootstrapAdmins(sql);
    return;
  }

  await ensureAuthSchema();
  await ensurePasswordResetSchema();

  // ===== 利用許可名簿 =====
  // ポータルの role / can_manage とは独立した、このアプリ固有の名簿。
  // ここに載っていない社員番号は、ログインできてもアプリを使えない。
  // is_owner は名簿自体を編集できる人（人事の責任者）。給与・考課も常に閲覧できる。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_admins (
      login_id       TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      is_owner       BOOLEAN NOT NULL DEFAULT false,
      can_payroll    BOOLEAN NOT NULL DEFAULT false,
      can_evaluation BOOLEAN NOT NULL DEFAULT false,
      note           TEXT,
      created_by     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  // ===== 組織ツリー =====
  // parent_id は自己参照。親を消しても子が孤児にならないよう SET NULL（画面側で「未配置」に出す）。
  // head_employee_id は jinji_employees への参照だが、employees 側も org_unit_id で
  // こちらを参照するため循環になる。FK は張らずアプリ側で整合を担保する（ポータルの
  // pf_portal_workplaces.admin_user_id と同じ方針）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_org_units (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id             UUID REFERENCES jinji_org_units(id) ON DELETE SET NULL,
      code                  TEXT NOT NULL UNIQUE,
      name                  TEXT NOT NULL,
      kind                  TEXT NOT NULL DEFAULT 'other',
      sort                  INTEGER NOT NULL DEFAULT 0,
      head_employee_id      UUID,
      portal_dept_code      TEXT,
      portal_workplace_code TEXT,
      description           TEXT,
      valid_from            DATE,
      valid_to              DATE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_org_units_parent_idx ON jinji_org_units(parent_id, sort)`);
  // ポータル突合キーは「値があるときだけ一意」。同期の二重取込を防ぐ。
  await safeDdl(() => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS jinji_org_units_portal_dept_uq
    ON jinji_org_units(portal_dept_code) WHERE portal_dept_code IS NOT NULL`);
  await safeDdl(() => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS jinji_org_units_portal_wp_uq
    ON jinji_org_units(portal_workplace_code) WHERE portal_workplace_code IS NOT NULL`);
  // 人事マスタ（階層シート）由来のコード。部署コードは工場・部の、職場コードは
  // 所属組織（8桁）の識別子。unit の code とは別に持つ（AUTO- 等の内部コードと分けるため）。
  await safeDdl(() => sql`ALTER TABLE jinji_org_units ADD COLUMN IF NOT EXISTS dept_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_org_units ADD COLUMN IF NOT EXISTS workplace_code TEXT`);

  // ===== 人事マスター =====
  // employee_no はポータルの login_id と同じ値を使う（SSO・権限連携の突合キー）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_employees (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_no     TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      name_kana       TEXT,
      gender          TEXT,
      birth_date      DATE,
      hire_date       DATE,
      employment_type TEXT,
      org_unit_id     UUID REFERENCES jinji_org_units(id) ON DELETE SET NULL,
      position_name   TEXT,
      duty_name       TEXT,
      grade           TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      retire_date     DATE,
      email           TEXT,
      phone           TEXT,
      note            TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_employees_org_idx ON jinji_employees(org_unit_id)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_employees_status_idx ON jinji_employees(status, name_kana)`);

  // 人事システムの名簿（Excel）から取り込む属性。既存DBにも足せるよう ADD COLUMN で継ぎ足す。
  // コードと名称を対で持つのは、名称は改称され得るがコードは変わらないため
  // （突合はコード、表示は名称、という使い分けをする）。
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS position_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS duty_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS grade_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS job_category_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS job_category TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS job_group_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS job_group TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS pay_class_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS pay_class TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS employee_class_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS employee_class TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS position_class_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS position_class TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS payroll_org_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS payroll_org_name TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS account_org_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS account_org_name TEXT`);
  // 管理者（承認者）。人事マスタの「一般とその管理者・管理者とその承認者」の一覧から入る。
  // 社員番号で持つ（管理者の社員レコードが後から入っても壊れないように）。
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS manager_employee_no TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_employees ADD COLUMN IF NOT EXISTS manager_name TEXT`);

  // ===== 異動申請書 =====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_transfers (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transfer_no      TEXT NOT NULL UNIQUE,
      employee_id      UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      kind             TEXT NOT NULL DEFAULT 'haichi',
      from_org_unit_id UUID,
      to_org_unit_id   UUID,
      from_position    TEXT,
      to_position      TEXT,
      from_duty        TEXT,
      to_duty          TEXT,
      from_grade       TEXT,
      to_grade         TEXT,
      order_date       DATE,
      effective_date   DATE,
      reason           TEXT,
      remarks          TEXT,
      status           TEXT NOT NULL DEFAULT 'draft',
      drafted_by       TEXT,
      drafted_name     TEXT,
      applied_at       TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_transfers_emp_idx ON jinji_transfers(employee_id, effective_date DESC)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_transfers_status_idx ON jinji_transfers(status, effective_date)`);

  // 指定帳票 J-426(9)（異動申請書・組織名称追加変更申請書）の記入欄。
  // すでに運用中のDBにも足せるよう、CREATE TABLE を書き換えずに ADD COLUMN で継ぎ足す。
  // 1文ずつ safeDdl で包むのは、同時初回アクセスのカタログ競合を無視するため。
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS form_kind TEXT NOT NULL DEFAULT 'transfer'`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS form_date DATE`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS arrival_date DATE`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS limited_from DATE`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS limited_to DATE`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS dept_agreement TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS org_name_before TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS org_name_after TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS relocation TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS housing_before TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS housing_after TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS assignment_before TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS assignment_after TEXT`);
  // <単身赴任 事由> は複数チェック可。①〜④の添字を配列で持つ
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS single_reasons JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS mobile TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS mobile_after TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS company_car TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS company_car_after TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS company_car_other TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS parking TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS commute_change TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS explained_agreed BOOLEAN NOT NULL DEFAULT false`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS successor_checked BOOLEAN NOT NULL DEFAULT false`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS system_dept_code TEXT`);
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS system_dept_name TEXT`);

  // ===== 一括異動申請（別紙）=====
  // 異動人数が多いとき、1枚の申請書に「別紙参照」と書き、対象者の一覧を別紙として添える。
  // is_bulk=true の申請は employee_id を代表者とし、実際の対象は items が持つ。
  await safeDdl(() => sql`ALTER TABLE jinji_transfers ADD COLUMN IF NOT EXISTS is_bulk BOOLEAN NOT NULL DEFAULT false`);
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_transfer_items (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transfer_id      UUID NOT NULL REFERENCES jinji_transfers(id) ON DELETE CASCADE,
      employee_id      UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      -- 申請時点の所属を焼き付ける（別紙の「現所属」がぶれないように）
      from_org_unit_id UUID,
      to_org_unit_id   UUID,
      effective_date   DATE,
      reason           TEXT,
      sort             INTEGER NOT NULL DEFAULT 0,
      UNIQUE (transfer_id, employee_id)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_transfer_items_transfer_idx ON jinji_transfer_items(transfer_id, sort)`);

  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_transfer_approvals (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transfer_id       UUID NOT NULL REFERENCES jinji_transfers(id) ON DELETE CASCADE,
      slot              TEXT NOT NULL,
      seq               INTEGER NOT NULL DEFAULT 0,
      approver_login_id TEXT,
      approver_name     TEXT,
      decision          TEXT NOT NULL DEFAULT 'pending',
      decided_at        TIMESTAMPTZ,
      comment           TEXT,
      UNIQUE (transfer_id, slot)
    )`);

  // 異動申請番号の年度連番（"J26-001" = プレフィックス + 西暦下2桁 + 連番）
  // kind 列で帳票の種類ごとに別の連番を持つ（異動 J / 継続雇用 R）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_counters (
      year INTEGER PRIMARY KEY,
      seq  INTEGER NOT NULL DEFAULT 0
    )`);
  await safeDdl(() => sql`ALTER TABLE jinji_counters ADD COLUMN IF NOT EXISTS reemp_seq INTEGER NOT NULL DEFAULT 0`);

  // ===== 異動案（組織図の上で編成する下書き）=====
  // 組織図でドラッグして人を動かした結果は、その場で人事マスターへ書かない。
  // 所属の変更は異動申請書（J-426）を通すのが正で、直接書き換えると履歴も帳票も残らないため。
  // ここには「案」として溜め、確定したときに対象者ぶんの申請書を起こす。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_org_plans (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL,
      -- 組織図をどの時点で見るか（過去日付の組織図の上でも編成できる）
      base_date    DATE,
      -- 発令予定日。申請書を起こすときの適用日になる
      effective_date DATE,
      status       TEXT NOT NULL DEFAULT 'draft',
      note         TEXT,
      created_by   TEXT,
      created_name TEXT,
      applied_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  // 案の中の1件＝1人の動き。from_* は案を作った時点の値を焼き付ける
  // （途中で人事マスターが変わっても、案の「現」がぶれないように）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_org_plan_moves (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id           UUID NOT NULL REFERENCES jinji_org_plans(id) ON DELETE CASCADE,
      employee_id       UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      from_org_unit_id  UUID,
      to_org_unit_id    UUID,
      from_position     TEXT,
      to_position       TEXT,
      from_duty         TEXT,
      to_duty           TEXT,
      -- 帳票の凡例に合わせた印: 'promo_both'=◎昇格(職務・役職) / 'promo_duty'=○昇格(職務) / 'move'=△所属移動
      mark              TEXT,
      transfer_id       UUID,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (plan_id, employee_id)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_org_plan_moves_plan_idx ON jinji_org_plan_moves(plan_id)`);

  // ===== 継続雇用申請書（指定帳票 J-456）=====
  // 高齢者雇用・アルバイト契約の満了に伴い、期間を限って雇用を継続することを申請する。
  // 異動申請と違い人事マスターへの発令は伴わないため、承認までで完結する。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_reemployments (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_no                  TEXT NOT NULL UNIQUE,
      employee_id             UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      -- 所属は申請時点の名称を焼き付ける（後から組織が変わっても帳票は当時のまま）
      org_unit_name           TEXT,
      current_employment_type TEXT,
      contract_end_date       DATE,
      employment_type         TEXT,
      period_from             DATE,
      period_to               DATE,
      work_place              TEXT,
      days_per_week           NUMERIC(3,1),
      work_start              TEXT,
      work_end                TEXT,
      break_hours             NUMERIC(3,1),
      -- 業務内容①②③ と 継続雇用の理由・必要性①〜④。見出しは帳票側の固定文言なので本文だけ持つ
      duties                  JSONB NOT NULL DEFAULT '[]'::jsonb,
      reasons                 JSONB NOT NULL DEFAULT '[]'::jsonb,
      compliance              TEXT,
      conclusion              TEXT,
      status                  TEXT NOT NULL DEFAULT 'draft',
      drafted_by              TEXT,
      drafted_name            TEXT,
      form_date               DATE,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_reemployments_emp_idx ON jinji_reemployments(employee_id, contract_end_date DESC)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_reemployments_status_idx ON jinji_reemployments(status, contract_end_date)`);

  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_reemployment_approvals (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reemployment_id   UUID NOT NULL REFERENCES jinji_reemployments(id) ON DELETE CASCADE,
      slot              TEXT NOT NULL,
      seq               INTEGER NOT NULL DEFAULT 0,
      approver_login_id TEXT,
      approver_name     TEXT,
      decision          TEXT NOT NULL DEFAULT 'pending',
      decided_at        TIMESTAMPTZ,
      comment           TEXT,
      UNIQUE (reemployment_id, slot)
    )`);

  // ===== 人事考課 =====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_evaluation_items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code        TEXT NOT NULL UNIQUE,
      category    TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL,
      description TEXT,
      max_score   INTEGER NOT NULL DEFAULT 5,
      sort        INTEGER NOT NULL DEFAULT 0,
      active      BOOLEAN NOT NULL DEFAULT true
    )`);

  // scores は「項目コード → 点数」の JSON。項目マスターを増減しても過去の評価が壊れない。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_evaluations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id         UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      period              TEXT NOT NULL,
      fiscal_year         INTEGER NOT NULL,
      half                TEXT NOT NULL,
      primary_evaluator   TEXT,
      primary_name        TEXT,
      primary_scores      JSONB NOT NULL DEFAULT '{}',
      primary_comment     TEXT,
      primary_done_at     TIMESTAMPTZ,
      secondary_evaluator TEXT,
      secondary_name      TEXT,
      secondary_scores    JSONB NOT NULL DEFAULT '{}',
      secondary_comment   TEXT,
      secondary_done_at   TIMESTAMPTZ,
      overall_rank        TEXT,
      total_score         NUMERIC,
      status              TEXT NOT NULL DEFAULT 'draft',
      finalized_at        TIMESTAMPTZ,
      finalized_by        TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (employee_id, period)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_evaluations_period_idx ON jinji_evaluations(period)`);

  // ===== 基本給与（履歴型）=====
  // 訂正は voided_at を立てて無効化する。行は消さない（改定の経緯を残すため）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_salaries (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id    UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      effective_from DATE NOT NULL,
      base_salary    INTEGER NOT NULL,
      allowances     JSONB NOT NULL DEFAULT '[]',
      grade          TEXT,
      step           TEXT,
      revision_kind  TEXT NOT NULL DEFAULT '新規登録',
      reason         TEXT,
      decided_by     TEXT,
      decided_name   TEXT,
      voided_at      TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // 同一社員・同一適用月の有効行は1本だけ（無効化した行は重複を許す）
  await safeDdl(() => sql`
    CREATE UNIQUE INDEX IF NOT EXISTS jinji_salaries_effective_uq
    ON jinji_salaries(employee_id, effective_from) WHERE voided_at IS NULL`);
  await safeDdl(() => sql`
    CREATE INDEX IF NOT EXISTS jinji_salaries_emp_idx ON jinji_salaries(employee_id, effective_from DESC)`);

  // ===== 資格 =====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_qualification_master (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code             TEXT NOT NULL UNIQUE,
      name             TEXT NOT NULL,
      category         TEXT NOT NULL DEFAULT 'other',
      renewal_required BOOLEAN NOT NULL DEFAULT false,
      renewal_months   INTEGER,
      sort             INTEGER NOT NULL DEFAULT 0,
      active           BOOLEAN NOT NULL DEFAULT true
    )`);
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_qualifications (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id    UUID NOT NULL REFERENCES jinji_employees(id) ON DELETE CASCADE,
      master_id      UUID REFERENCES jinji_qualification_master(id) ON DELETE SET NULL,
      name           TEXT NOT NULL,
      category       TEXT NOT NULL DEFAULT 'other',
      acquired_on    DATE,
      expires_on     DATE,
      certificate_no TEXT,
      issuer         TEXT,
      note           TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_qualifications_emp_idx ON jinji_qualifications(employee_id)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_qualifications_expiry_idx ON jinji_qualifications(expires_on)`);

  // ===== 監査ログ =====
  // 人事情報は機微なため、給与・考課は「閲覧」も記録する。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS jinji_audit_logs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_login_id  TEXT NOT NULL,
      actor_name      TEXT,
      action          TEXT NOT NULL,
      target_type     TEXT,
      target_id       TEXT,
      target_label    TEXT,
      detail          JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_audit_logs_created_idx ON jinji_audit_logs(created_at DESC)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS jinji_audit_logs_target_idx ON jinji_audit_logs(target_type, target_id)`);

  await seedEvaluationItems(sql);
  await bootstrapAdmins(sql);
  // 既に取り込み済みのデータにも「長欠の職場＝休職」を効かせる（版が上がった1回だけ）。
  // 以後は取込のたびに importRoster / importHrMaster が掛け直す。
  await applyLeaveByOrgName(sql);
  // 調達部の階層を実態（調達部 → 調達室 → 企画/管理グループ）に合わせる。
  // 業務都合の一度きりの整備なので、失敗してもアプリの起動は止めない。
  try {
    await applyChotatsuStructure(sql);
  } catch (e) {
    console.warn("[schema] 調達部の整備に失敗:", (e as Error).message);
  }

  // ここまで通ったら版を記録する。以後のコールドスタートは1往復で済む。
  // 途中で失敗した場合は記録されないので、次回また最初から流れる。
  await recordSchemaVersion();
}

/**
 * 人事考課の項目マスターが空のときだけ、標準的な考課項目を投入する。
 * 運用開始後は設定画面から増減する（ここは初回だけ）。
 */
async function seedEvaluationItems(sql: ReturnType<typeof getSql>): Promise<void> {
  try {
    const rows = await sql`SELECT count(*)::int AS n FROM jinji_evaluation_items`;
    if ((rows[0]?.n as number) !== 0) return;
    const items: [string, string, string, number, number][] = [
      ["A01", "業績", "目標達成度", 10, 1],
      ["A02", "業績", "業務品質", 10, 2],
      ["A03", "業績", "生産性・効率", 10, 3],
      ["B01", "能力", "専門知識・技能", 5, 4],
      ["B02", "能力", "課題形成・改善提案", 5, 5],
      ["B03", "能力", "判断力", 5, 6],
      ["C01", "情意", "責任感・規律性", 5, 7],
      ["C02", "情意", "協調性・チーム貢献", 5, 8],
      ["C03", "情意", "積極性", 5, 9],
      ["D01", "管理", "部下育成・指導", 5, 10],
    ];
    for (const [code, category, name, maxScore, sort] of items) {
      await sql`
        INSERT INTO jinji_evaluation_items (code, category, name, max_score, sort)
        VALUES (${code}, ${category}, ${name}, ${maxScore}, ${sort})
        ON CONFLICT (code) DO NOTHING`;
    }
  } catch (e) {
    console.warn("[schema] evaluation item seed skipped:", (e as Error).message);
  }
}

/**
 * 利用許可名簿の初期投入。
 * JINJI_BOOTSTRAP_ADMIN_IDS（社員番号のカンマ区切り）が設定されている環境でのみ、
 * その社員番号を owner として冪等に投入する。既に居れば何もしない。
 * env が無い環境では名簿は空のままで、初期セットアップ画面から登録する。
 */
async function bootstrapAdmins(sql: ReturnType<typeof getSql>): Promise<void> {
  const raw = (process.env.JINJI_BOOTSTRAP_ADMIN_IDS ?? "").trim();
  if (!raw) return;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const loginId of ids) {
    try {
      await sql`
        INSERT INTO jinji_admins (login_id, name, is_owner, can_payroll, can_evaluation, note, created_by)
        VALUES (${loginId}, ${loginId}, true, true, true, ${"環境変数による初期登録"}, ${"bootstrap"})
        ON CONFLICT (login_id) DO NOTHING`;
    } catch (e) {
      console.warn("[schema] admin bootstrap skipped:", loginId, (e as Error).message);
    }
  }
}

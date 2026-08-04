/**
 * PF人事管理のドメイン型とラベル定義。
 *
 * 表示ラベルはここに集約する（画面・帳票・CSV で同じ語を使うため）。
 * DB に入るのは英字コード、人に見せるのは日本語ラベル、という対応を全機能で守る。
 */

// ===== 利用許可名簿 =====

/**
 * pf-jinji の利用許可。ポータルの role / can_manage とは独立した、このアプリ固有の名簿。
 * 名簿に載っていない社員番号は SSO でログインできてもアプリを使えない（/forbidden）。
 */
export interface JinjiAdmin {
  loginId: string;
  name: string;
  /** 名簿そのものを編集できる（人事の責任者）。給与・考課も常に閲覧可 */
  isOwner: boolean;
  /** 基本給与の閲覧・編集 */
  canPayroll: boolean;
  /** 人事考課の閲覧・編集 */
  canEvaluation: boolean;
  note: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

/** ログイン中ユーザーの人事アプリ上の権限（DBから都度取得する）。 */
export interface JinjiGrant {
  loginId: string;
  name: string;
  isOwner: boolean;
  canPayroll: boolean;
  canEvaluation: boolean;
}

// ===== 組織 =====

/** 組織単位の種別。ポータル由来（dept/factory/workplace）と人事側で足す階層を併せ持つ。 */
export type OrgKind = "honbu" | "bu" | "ka" | "kakari" | "factory" | "workplace" | "other";

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  honbu: "本部",
  bu: "部",
  ka: "課",
  kakari: "係",
  factory: "工場",
  workplace: "職場",
  other: "その他",
};

export const ORG_KIND_ORDER: OrgKind[] = ["honbu", "bu", "ka", "kakari", "factory", "workplace", "other"];

export function normalizeOrgKind(v: unknown): OrgKind {
  return ORG_KIND_ORDER.includes(v as OrgKind) ? (v as OrgKind) : "other";
}

export interface OrgUnit {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: OrgKind;
  sort: number;
  /** 上長（jinji_employees.id）。循環参照を避けるため FK は張らずアプリ側で整合を担保する */
  headEmployeeId: string | null;
  /** ポータル部署マスタ（pf_portal_departments.code）との突合キー */
  portalDeptCode: string | null;
  /** ポータル職場（pf_portal_workplaces.code）との突合キー */
  portalWorkplaceCode: string | null;
  description: string | null;
  validFrom: string | null;
  validTo: string | null;
}

/** 組織図描画用のツリーノード。 */
export interface OrgNode extends OrgUnit {
  children: OrgNode[];
  /** この組織に直接所属する在籍者数 */
  memberCount: number;
  /** 配下すべてを含む在籍者数 */
  totalCount: number;
  headName: string | null;
  depth: number;
}

// ===== 社員 =====

export type EmploymentStatus = "active" | "leave" | "loaned" | "retired";

export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  active: "在籍",
  leave: "休職",
  loaned: "出向",
  retired: "退職",
};

export const EMPLOYMENT_STATUS_ORDER: EmploymentStatus[] = ["active", "leave", "loaned", "retired"];

export function normalizeEmploymentStatus(v: unknown): EmploymentStatus {
  return EMPLOYMENT_STATUS_ORDER.includes(v as EmploymentStatus) ? (v as EmploymentStatus) : "active";
}

/** 雇用体系。ポータルの employment_type と同じ語を使う（自由入力も許容するため文字列）。 */
export const EMPLOYMENT_TYPES = ["正社員", "契約社員", "嘱託", "パート・アルバイト", "派遣", "出向受入"] as const;

export type Gender = "male" | "female" | "other";

export const GENDER_LABEL: Record<Gender, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
};

export interface Employee {
  id: string;
  /** 社員番号。ポータルの login_id と同じ値を使う（SSO・権限連携の突合キー） */
  employeeNo: string;
  name: string;
  nameKana: string | null;
  gender: Gender | null;
  birthDate: string | null;
  hireDate: string | null;
  employmentType: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  /** 役職（部長・課長 等） */
  positionName: string | null;
  /** 職務（担当業務） */
  dutyName: string | null;
  /** 資格等級 */
  grade: string | null;
  status: EmploymentStatus;
  retireDate: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ===== 異動申請書 =====

export type TransferKind =
  | "haichi"
  | "shoshin"
  | "koukaku"
  | "tenkin"
  | "shukkou"
  | "kenmu"
  | "kenmu_kaijo"
  | "fukushoku"
  | "taishoku";

export const TRANSFER_KIND_LABEL: Record<TransferKind, string> = {
  haichi: "配置転換",
  shoshin: "昇進・昇格",
  koukaku: "降格",
  tenkin: "転勤",
  shukkou: "出向",
  kenmu: "兼務",
  kenmu_kaijo: "兼務解除",
  fukushoku: "復職",
  taishoku: "退職",
};

export const TRANSFER_KIND_ORDER: TransferKind[] = [
  "haichi",
  "shoshin",
  "koukaku",
  "tenkin",
  "shukkou",
  "kenmu",
  "kenmu_kaijo",
  "fukushoku",
  "taishoku",
];

export function normalizeTransferKind(v: unknown): TransferKind {
  return TRANSFER_KIND_ORDER.includes(v as TransferKind) ? (v as TransferKind) : "haichi";
}

/**
 * 異動申請の状態。
 * draft（起案中）→ submitted（申請中）→ approved（承認済）→ issued（発令済＝人事マスターへ反映済）
 * rejected（差戻）は submitted から戻る。
 */
export type TransferStatus = "draft" | "submitted" | "approved" | "issued" | "rejected";

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  draft: "起案中",
  submitted: "申請中",
  approved: "承認済",
  issued: "発令済",
  rejected: "差戻",
};

export function normalizeTransferStatus(v: unknown): TransferStatus {
  const all: TransferStatus[] = ["draft", "submitted", "approved", "issued", "rejected"];
  return all.includes(v as TransferStatus) ? (v as TransferStatus) : "draft";
}

export interface Transfer {
  id: string;
  transferNo: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  kind: TransferKind;
  fromOrgUnitId: string | null;
  fromOrgUnitName: string | null;
  toOrgUnitId: string | null;
  toOrgUnitName: string | null;
  fromPosition: string | null;
  toPosition: string | null;
  fromDuty: string | null;
  toDuty: string | null;
  fromGrade: string | null;
  toGrade: string | null;
  /** 発令日（辞令の日付） */
  orderDate: string | null;
  /** 適用日（新所属での勤務開始日） */
  effectiveDate: string | null;
  reason: string | null;
  remarks: string | null;
  status: TransferStatus;
  draftedBy: string | null;
  draftedName: string | null;
  /** 人事マスターへ反映した日時。null なら未反映 */
  appliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * 異動申請書の承認欄（捺印枠）。
 * 実物の指定フォームを受領したら TRANSFER_APPROVAL_SLOTS の並びだけを差し替える。
 */
export const TRANSFER_APPROVAL_SLOTS = [
  { slot: "drafter", label: "起案" },
  { slot: "section_head", label: "所属長" },
  { slot: "dept_head", label: "部門長" },
  { slot: "hr", label: "人事" },
  { slot: "division_head", label: "本部長" },
] as const;

export type TransferApprovalSlot = (typeof TRANSFER_APPROVAL_SLOTS)[number]["slot"];

export type ApprovalDecision = "pending" | "approved" | "rejected";

export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  pending: "未",
  approved: "承認",
  rejected: "差戻",
};

export interface TransferApproval {
  id: string;
  transferId: string;
  slot: TransferApprovalSlot;
  label: string;
  seq: number;
  approverLoginId: string | null;
  approverName: string | null;
  decision: ApprovalDecision;
  decidedAt: string | null;
  comment: string | null;
}

// ===== 人事考課 =====

export type EvaluationHalf = "H1" | "H2";

export const EVALUATION_HALF_LABEL: Record<EvaluationHalf, string> = {
  H1: "上期",
  H2: "下期",
};

export type EvaluationStatus = "draft" | "primary_done" | "secondary_done" | "finalized";

export const EVALUATION_STATUS_LABEL: Record<EvaluationStatus, string> = {
  draft: "未着手",
  primary_done: "一次評価済",
  secondary_done: "二次評価済",
  finalized: "確定",
};

/** 総合評価ランク。S が最上位。 */
export const EVALUATION_RANKS = ["S", "A", "B", "C", "D"] as const;
export type EvaluationRank = (typeof EVALUATION_RANKS)[number];

export interface EvaluationItem {
  id: string;
  code: string;
  category: string;
  name: string;
  description: string | null;
  maxScore: number;
  sort: number;
  active: boolean;
}

export interface Evaluation {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  orgUnitName: string | null;
  /** 評価期（例 2026H1）。fiscalYear + half から作る */
  period: string;
  fiscalYear: number;
  half: EvaluationHalf;
  primaryEvaluator: string | null;
  primaryName: string | null;
  /** 項目コード → 点数 */
  primaryScores: Record<string, number>;
  primaryComment: string | null;
  primaryDoneAt: string | null;
  secondaryEvaluator: string | null;
  secondaryName: string | null;
  secondaryScores: Record<string, number>;
  secondaryComment: string | null;
  secondaryDoneAt: string | null;
  overallRank: EvaluationRank | null;
  totalScore: number | null;
  status: EvaluationStatus;
  finalizedAt: string | null;
  finalizedBy: string | null;
}

export function periodOf(fiscalYear: number, half: EvaluationHalf): string {
  return `${fiscalYear}${half}`;
}

// ===== 基本給与 =====

/** 改定区分。 */
export const SALARY_REVISION_KINDS = ["新規登録", "定期昇給", "昇格改定", "臨時改定", "降給"] as const;

export interface SalaryAllowance {
  name: string;
  amount: number;
}

/**
 * 基本給与のレコードは履歴型。1社員につき複数行を持ち、適用開始年月の最も新しい
 * 有効行が「現在の給与」になる。訂正は voided_at を立てて無効化し、行は消さない。
 */
export interface Salary {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  /** 適用開始日（月初で運用する） */
  effectiveFrom: string;
  baseSalary: number;
  allowances: SalaryAllowance[];
  grade: string | null;
  step: string | null;
  revisionKind: string;
  reason: string | null;
  decidedBy: string | null;
  decidedName: string | null;
  voidedAt: string | null;
  createdAt: string | null;
}

export function salaryTotal(s: Pick<Salary, "baseSalary" | "allowances">): number {
  return s.baseSalary + s.allowances.reduce((n, a) => n + (Number.isFinite(a.amount) ? a.amount : 0), 0);
}

// ===== 資格 =====

export type QualificationCategory = "national" | "internal" | "skill" | "other";

export const QUALIFICATION_CATEGORY_LABEL: Record<QualificationCategory, string> = {
  national: "国家資格",
  internal: "社内資格",
  skill: "技能講習・特別教育",
  other: "その他",
};

export function normalizeQualificationCategory(v: unknown): QualificationCategory {
  const all: QualificationCategory[] = ["national", "internal", "skill", "other"];
  return all.includes(v as QualificationCategory) ? (v as QualificationCategory) : "other";
}

export interface QualificationMaster {
  id: string;
  code: string;
  name: string;
  category: QualificationCategory;
  renewalRequired: boolean;
  /** 更新間隔（月）。renewalRequired のときだけ意味を持つ */
  renewalMonths: number | null;
  sort: number;
  active: boolean;
}

export interface Qualification {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  orgUnitName: string | null;
  masterId: string | null;
  name: string;
  category: QualificationCategory;
  acquiredOn: string | null;
  expiresOn: string | null;
  certificateNo: string | null;
  issuer: string | null;
  note: string | null;
}

// ===== 監査ログ =====

/**
 * 監査対象の操作。人事情報は機微なため、給与・考課は「閲覧」も記録する。
 */
export type AuditAction =
  | "view_payroll"
  | "update_payroll"
  | "view_evaluation"
  | "update_evaluation"
  | "create_employee"
  | "update_employee"
  | "delete_employee"
  | "create_transfer"
  | "update_transfer"
  | "approve_transfer"
  | "apply_transfer"
  | "update_org"
  | "sync_portal"
  | "push_portal"
  | "update_admin";

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  view_payroll: "給与を閲覧",
  update_payroll: "給与を更新",
  view_evaluation: "考課を閲覧",
  update_evaluation: "考課を更新",
  create_employee: "社員を登録",
  update_employee: "社員を更新",
  delete_employee: "社員を削除",
  create_transfer: "異動申請を作成",
  update_transfer: "異動申請を更新",
  approve_transfer: "異動申請を承認/差戻",
  apply_transfer: "異動を発令・反映",
  update_org: "組織を変更",
  sync_portal: "ポータル部署を取込",
  push_portal: "ポータルへ人事情報を連携",
  update_admin: "利用許可名簿を変更",
};

export interface AuditLog {
  id: string;
  actorLoginId: string;
  actorName: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string | null;
}

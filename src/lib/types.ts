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

/**
 * 帳票 J-426(9) は「異動申請書」と「組織名称追加変更申請書」を1枚で兼ねる。
 * どちらとして起票したかで、印刷時に埋まる欄と入力時に出す欄が変わる。
 */
export type TransferFormKind = "transfer" | "org_rename";

export const TRANSFER_FORM_KIND_LABEL: Record<TransferFormKind, string> = {
  transfer: "異動申請",
  org_rename: "組織名称追加変更",
};

export function normalizeTransferFormKind(v: unknown): TransferFormKind {
  return v === "org_rename" ? "org_rename" : "transfer";
}

/**
 * 帳票のチェック欄。実物は「該当にㇾ点」を手書きする欄なので、
 * 値は必ず「未選択（null）」を持てるようにしてある（印刷しても空欄のまま出せる）。
 */
export const YES_NO = ["あり", "なし"] as const;
/** 【転居】【携帯】【社用車】【通勤経路変更】で共通。 */
export type YesNo = (typeof YES_NO)[number];

/** 【異動前 住居】【異動後 住居】 */
export const HOUSING_KINDS = ["持家・個人契約", "社宅・会社契約", "実家"] as const;

/** 【異動前 赴任形態】【異動後 赴任形態】 */
export const ASSIGNMENT_KINDS = ["家族帯同", "独身", "単身赴任"] as const;

/** <単身赴任 事由>（複数チェック可）。番号は帳票の①〜④に対応する。 */
export const SINGLE_ASSIGNMENT_REASONS = [
  "小学生、中学生、高校生の子女がいる",
  "同居家族に介護を要する者がいる",
  "配偶者が就業していることにより同行できない",
  "その他、事情により会社が認めた場合",
] as const;

/** 【携帯】あり のときの【異動後】の扱い。J-431/J-432 の添付要否まで文言に含む。 */
export const MOBILE_AFTER_KINDS = [
  "継続利用",
  "不要（J-432を添付）",
  "ガラケー⇒iphone へ変更（J-431を添付）",
  "iphone ⇒ガラケーへ変更（J-431を添付）",
] as const;

/** 【社用車】あり のときの異動後の扱い。 */
export const COMPANY_CAR_AFTER_KINDS = ["異動先で使用", "別の社員が使用", "不要", "その他"] as const;

/** 【社用車駐車場】 */
export const PARKING_KINDS = ["解約要", "なし"] as const;

/** 【部門長間の合意】（＊部門をまたぐ場合のみ） */
export const DEPT_AGREEMENTS = ["済み", "未決"] as const;

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

  // ===== 以下、帳票 J-426(9) の記入欄 =====
  /** 異動申請 / 組織名称追加変更 のどちらとして起票したか */
  formKind: TransferFormKind;
  /** 帳票右上の作成日 */
  formDate: string | null;
  /** 異動先赴任日（異動日付とは別に記入する欄がある） */
  arrivalDate: string | null;
  /** ※期間限定の場合（〜まで） */
  limitedFrom: string | null;
  limitedTo: string | null;
  /** 【部門長間の合意】部門をまたぐ場合のみ。'済み' | '未決' | null */
  deptAgreement: string | null;
  /** 【組織名称】変更前 / 追加・変更後 */
  orgNameBefore: string | null;
  orgNameAfter: string | null;
  /** 【転居】あり/なし */
  relocation: string | null;
  housingBefore: string | null;
  housingAfter: string | null;
  /** 【異動前/異動後 赴任形態】 */
  assignmentBefore: string | null;
  assignmentAfter: string | null;
  /** <単身赴任 事由>（複数可）。SINGLE_ASSIGNMENT_REASONS の添字 0-3 */
  singleReasons: number[];
  /** 【携帯】あり/なし と、あり の場合の異動後の扱い */
  mobile: string | null;
  mobileAfter: string | null;
  /** 【社用車】あり/なし と、あり の場合の異動後の扱い */
  companyCar: string | null;
  companyCarAfter: string | null;
  /** 社用車「その他」を選んだときの括弧内 */
  companyCarOther: string | null;
  /** 【社用車駐車場】 */
  parking: string | null;
  /** 【通勤経路変更】あり/なし */
  commuteChange: string | null;
  /** 【本人への説明・合意】説明を行い、合意を得た */
  explainedAgreed: boolean;
  /** 【後任の確認】確認済 */
  successorChecked: boolean;
  /** 情報ｼｽﾃﾑ部記入欄：部門コード（8桁）と名称 */
  systemDeptCode: string | null;
  systemDeptName: string | null;
}

/**
 * 異動申請書 J-426(9) の【承認】欄（捺印枠）。
 *
 * 実物では帳票下部に2つの枠がある。
 * - 右の「承認」枠 … 申請者・部門長・役員。**ここが決裁のルート**なので、
 *   3つ揃って初めて発令できる（本配列がその判定に使われる）。
 * - 左の枠（総務人事部長・情報ｼｽﾃﾑ部・人事統括室）と【総務人事部使用欄】…
 *   決裁後の回付・処理を記録する枠。承認の可否とは無関係なので、
 *   アプリでは押印用の空欄として印刷するだけにする（TRANSFER_ROUTING_BOXES）。
 *
 * 印刷は帳票に合わせて右から「役員・部門長・申請者」の順に並べる。
 */
export const TRANSFER_APPROVAL_SLOTS = [
  { slot: "applicant", label: "申請者" },
  { slot: "dept_head", label: "部門長" },
  { slot: "executive", label: "役員" },
] as const;

/** 決裁後に回付されるだけの押印枠（アプリは記録せず、空欄で印刷する）。 */
export const TRANSFER_ROUTING_BOXES = ["総務人事部長", "情報ｼｽﾃﾑ部", "人事統括室"] as const;

/** 【総務人事部使用欄】の処理順。帳票では「→」でつないで1行に並ぶ。 */
export const TRANSFER_HR_PROCESS_BOXES = [
  { label: "総務人事部長", note: "（確認）" },
  { label: "人事マスタ担当", note: "（辞令発行）" },
  { label: "職務手当担当", note: "（支給・停止）" },
  { label: "紙", note: "(10年保管)" },
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

// ===== 継続雇用申請書（帳票 J-456）=====

/**
 * 高齢者雇用・アルバイト契約満了に伴う継続雇用申請書。
 * 契約が満了する社員について、期間を限って雇用を継続することを申請する帳票。
 */
export const REEMPLOYMENT_TYPES = ["高齢者雇用（有期契約）継続", "アルバイト雇用契約"] as const;

/**
 * 【継続雇用の理由・必要性】の4項目。帳票では①〜④の見出しが常に印字され、
 * その下に理由を書く。見出しは固定なので、アプリは本文だけを持つ。
 */
export const REEMPLOYMENT_REASON_HEADINGS = [
  "専門性・経験の活用",
  "技術・ノウハウの継承",
  "人員体制上の必要性",
  "期間限定を前提とした措置",
] as const;

/**
 * 帳票の行数。業務内容は①②③の3行、理由は①〜④の4行で固定されている。
 * 入力欄・保存・印刷のすべてがこの長さに揃う。
 *
 * ※ 画面（クライアント側）からも参照するので、DBに触れる lib/reemployments.ts ではなく
 *    ここに置く。あちらに置くとサーバー専用モジュールがブラウザのバンドルに入ってしまう。
 */
export const REEMPLOYMENT_DUTY_COUNT = 3;
export const REEMPLOYMENT_REASON_COUNT = REEMPLOYMENT_REASON_HEADINGS.length;

/** 帳票に定型で刷られている文言。編集できるようにしつつ、既定値はここに置く。 */
export const REEMPLOYMENT_FIXED_TEXT = {
  lead: "上記対象者について、継続雇用を申請いたします。",
  compliance: "就業規則およびアルバイト雇用規程に基づく契約とする。",
  conclusion1: "期間限定の継続雇用措置です。",
  conclusion2:
    "業務の安定的移行および将来的な自走体制確立のため、上記内容にてご承認をお願い申し上げます。",
} as const;

/** 継続雇用申請の状態。異動申請と違い人事マスターへの発令は伴わない。 */
export type ReemploymentStatus = "draft" | "submitted" | "approved" | "rejected";

export const REEMPLOYMENT_STATUS_LABEL: Record<ReemploymentStatus, string> = {
  draft: "起案中",
  submitted: "申請中",
  approved: "承認済",
  rejected: "差戻",
};

export function normalizeReemploymentStatus(v: unknown): ReemploymentStatus {
  const all: ReemploymentStatus[] = ["draft", "submitted", "approved", "rejected"];
  return all.includes(v as ReemploymentStatus) ? (v as ReemploymentStatus) : "draft";
}

/** 継続雇用申請書の【承認欄】。帳票では横並びの押印枠。 */
export const REEMPLOYMENT_APPROVAL_SLOTS = [
  { slot: "applicant", label: "申請者" },
  { slot: "section_head", label: "所属長" },
  { slot: "dept_head", label: "部門長" },
  { slot: "hr", label: "総務人事部長" },
  { slot: "executive", label: "役員" },
] as const;

export type ReemploymentApprovalSlot = (typeof REEMPLOYMENT_APPROVAL_SLOTS)[number]["slot"];

/** 継続雇用申請書の承認欄。構造は異動申請と同じだが枠の並びが違う。 */
export interface ReemploymentApproval {
  id: string;
  reemploymentId: string;
  slot: ReemploymentApprovalSlot;
  label: string;
  seq: number;
  approverLoginId: string | null;
  approverName: string | null;
  decision: ApprovalDecision;
  decidedAt: string | null;
  comment: string | null;
}

export interface Reemployment {
  id: string;
  docNo: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  /** 所属（帳票の「所属」。申請時点の名称を焼き付ける） */
  orgUnitName: string | null;
  /** 現在の雇用形態 */
  currentEmploymentType: string | null;
  /** 契約満了日 */
  contractEndDate: string | null;
  /** 申請する雇用形態（REEMPLOYMENT_TYPES） */
  employmentType: string | null;
  /** 契約期間 */
  periodFrom: string | null;
  periodTo: string | null;
  workPlace: string | null;
  /** 週あたり勤務日数 */
  daysPerWeek: number | null;
  /** 勤務時間 "08:00" 形式 */
  workStart: string | null;
  workEnd: string | null;
  breakHours: number | null;
  /** 業務内容①②③ */
  duties: string[];
  /** 継続雇用の理由・必要性①〜④ */
  reasons: string[];
  compliance: string | null;
  conclusion: string | null;
  status: ReemploymentStatus;
  draftedBy: string | null;
  draftedName: string | null;
  formDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * 年齢を求める。契約満了日時点の満年齢（帳票の「年齢」欄）。
 * 基準日が無ければ今日で計算する。
 */
export function ageAt(birthDate: string | null, on: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const d = on ? new Date(on) : new Date();
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null;
  let age = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age--;
  return age >= 0 ? age : null;
}

/** 実働時間＝終了−開始−休憩。帳票の「（休憩 h ・ 実働 h）」に出す。 */
export function actualWorkHours(
  start: string | null,
  end: string | null,
  breakHours: number | null,
): number | null {
  if (!start || !end) return null;
  const toMin = (v: string) => {
    const [h, m] = v.split(":").map((n) => Number(n));
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const s = toMin(start);
  const e = toMin(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  // 日をまたぐ勤務（22:00〜翌6:00 等）も扱えるようにする
  const span = (e >= s ? e - s : e + 24 * 60 - s) / 60;
  const net = span - (breakHours ?? 0);
  return net > 0 ? Math.round(net * 100) / 100 : null;
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
  | "create_reemployment"
  | "update_reemployment"
  | "approve_reemployment"
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
  create_reemployment: "継続雇用申請を作成",
  update_reemployment: "継続雇用申請を更新",
  approve_reemployment: "継続雇用申請を承認/差戻",
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

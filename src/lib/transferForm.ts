import type { Transfer } from "./types";
import { SINGLE_ASSIGNMENT_REASONS } from "./types";

/**
 * 指定帳票 **J-426(9)「異動申請書 ・ 組織名称追加変更申請書」** の定義。
 *
 * 実物のExcelに合わせてある。帳票のレイアウトは
 * src/app/transfers/[id]/print/page.tsx が、入力欄は src/app/transfers/_form/
 * が、それぞれこのファイルの定義を参照する。見出し語や選択肢を直すときは
 * ここと src/lib/types.ts（選択肢の値）を触れば全体に効く。
 *
 * 実物との対応で気をつけている点:
 * - チェック欄はすべて「未選択」を持てる（実物は手書きでㇾ点を入れる欄なので、
 *   空欄のまま印刷して手で書き込む運用ができる）。
 * - 【異動事由】は罫線だけの3行の自由記述欄。改行をそのまま帳票に流す。
 * - 【総務人事部使用欄】と情報ｼｽﾃﾑ部記入欄は、決裁後に人事側が書き込む欄。
 *   アプリからは情報ｼｽﾃﾑ部の「部門コード・名称」だけ入力できるようにしてある。
 */

export const TRANSFER_FORM = {
  /** 帳票のタイトル。実物は中黒で2つの申請を1枚に兼ねている */
  title: "異動申請書　・　組織名称追加変更申請書",
  /** 表題直下の一文 */
  lead: "下記の通り人事異動・組織名称追加変更を申請いたします。",
  /** 帳票番号（用紙の左下） */
  formNo: "帳票番号J-426（9）",
  /** 申請番号の接頭辞。"J26-001" の "J" */
  noPrefix: "J",
  /** 連番の桁数 */
  noDigits: 3,
  /** 用紙下部の注意書き（実物の文言をそのまま出す） */
  notes: [
    "＊部内異動のみ部門長決裁とします。但しその異動が職務のある者の場合は社長決裁とします。",
    "＊転居を伴う異動は遅くとも異動日の2ヶ月前迄に、転居を伴わない異動は異動日の15日前迄に 申請してください。",
  ],
  /** チェック欄の上に出る注記 */
  checkNote: "該当にㇾ点",
  /** 【異動部署】欄の注記 */
  dutyNote: "※異動に伴い職務が変更になる場合は、その内容も記載",
  /** 【部門長間の合意】の適用条件 */
  deptAgreementNote: "（＊部門をまたぐ場合のみ）",
} as const;

/**
 * 【異動部署】は「現所属部署 → 異動先部署」を **部署・職務の2行**で対比する。
 * 実物のフォームに役職・等級の欄は無いため、帳票には出さない
 * （アプリ側では役職・等級も保持していて、発令時に人事マスターへ反映される）。
 */
export interface FormComparisonRow {
  label: string;
  before: (t: Transfer) => string;
  after: (t: Transfer) => string;
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v : "");

export const TRANSFER_COMPARISON_ROWS: FormComparisonRow[] = [
  {
    label: "部署：",
    before: (t) => blank(t.fromOrgUnitName),
    after: (t) => blank(t.toOrgUnitName),
  },
  {
    label: "職務：",
    before: (t) => blank(t.fromDuty),
    after: (t) => blank(t.toDuty),
  },
];

/**
 * 【対象社員】欄。実物は「部署 / 社員ｺｰﾄﾞ / 氏名」の3行。
 * 部署は異動前の所属を出す（誰の異動かを特定するための欄なので現況を書く）。
 */
export interface FormHeaderField {
  label: string;
  value: (t: Transfer) => string;
}

export const TRANSFER_SUBJECT_FIELDS: FormHeaderField[] = [
  { label: "部　　　署", value: (t) => blank(t.fromOrgUnitName) },
  { label: "社員ｺｰﾄﾞ", value: (t) => t.employeeNo },
  { label: "氏　　　名", value: (t) => t.employeeName },
];

/** 単身赴任事由の表示文字列（①〜④の丸数字つき）。 */
export function singleReasonLabel(index: number): string {
  const marks = ["①", "②", "③", "④"];
  return `${marks[index] ?? ""} ${SINGLE_ASSIGNMENT_REASONS[index] ?? ""}`;
}

/**
 * 申請番号を組み立てる。"J26-001"＝接頭辞＋西暦下2桁＋年内連番。
 * 連番は jinji_counters が採番する（lib/transfers.ts）。
 */
export function buildTransferNo(year: number, seq: number): string {
  const yy = String(year % 100).padStart(2, "0");
  return `${TRANSFER_FORM.noPrefix}${yy}-${String(seq).padStart(TRANSFER_FORM.noDigits, "0")}`;
}

/**
 * 継続雇用申請書（J-456）の書類番号。"R26-001"。
 * 異動申請とは別系列の連番にする（帳票が別物のため）。
 */
export function buildReemploymentNo(year: number, seq: number): string {
  const yy = String(year % 100).padStart(2, "0");
  return `R${yy}-${String(seq).padStart(3, "0")}`;
}

import type { Transfer } from "./types";
import { TRANSFER_KIND_LABEL } from "./types";
import { formatDate } from "./format";

/**
 * 異動申請書の**帳票定義**。
 *
 * 指定フォーム（Excel/PDF）の実物を受領したら、差し替えるのはこのファイルと
 * 印刷ページのレイアウトだけで済むようにしてある。入力欄・DB列・画面は
 * この定義を参照するので、項目の並びや見出し語の変更はここ1か所で効く。
 *
 * 現状は一般的な異動申請書の項目で構成した暫定版。
 */

/** 帳票のタイトルと管理情報。 */
export const TRANSFER_FORM = {
  title: "異 動 申 請 書",
  /** 帳票番号（実物のフォームに合わせて差し替える） */
  formNo: "",
  /** 申請番号の接頭辞。"J26-001" の "J" */
  noPrefix: "J",
  /** 連番の桁数 */
  noDigits: 3,
} as const;

/** 帳票に出す1行の定義。左に見出し、右に「現」「新」を並べる。 */
export interface FormComparisonRow {
  label: string;
  before: (t: Transfer) => string;
  after: (t: Transfer) => string;
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/**
 * 「現 → 新」で対比表示する項目。
 * 実物のフォームに項目が増減したら、この配列を編集する。
 */
export const TRANSFER_COMPARISON_ROWS: FormComparisonRow[] = [
  {
    label: "所属",
    before: (t) => dash(t.fromOrgUnitName),
    after: (t) => dash(t.toOrgUnitName),
  },
  {
    label: "役職",
    before: (t) => dash(t.fromPosition),
    after: (t) => dash(t.toPosition),
  },
  {
    label: "職務",
    before: (t) => dash(t.fromDuty),
    after: (t) => dash(t.toDuty),
  },
  {
    label: "等級",
    before: (t) => dash(t.fromGrade),
    after: (t) => dash(t.toGrade),
  },
];

/** 帳票ヘッダに出す単票項目。 */
export interface FormHeaderField {
  label: string;
  value: (t: Transfer) => string;
}

export const TRANSFER_HEADER_FIELDS: FormHeaderField[] = [
  { label: "申請番号", value: (t) => t.transferNo },
  { label: "異動区分", value: (t) => TRANSFER_KIND_LABEL[t.kind] },
  { label: "発令日", value: (t) => formatDate(t.orderDate) },
  { label: "適用日", value: (t) => formatDate(t.effectiveDate) },
];

/**
 * 申請番号を組み立てる。"J26-001"＝接頭辞＋西暦下2桁＋年内連番。
 * 連番は jinji_counters が採番する（lib/transfers.ts）。
 */
export function buildTransferNo(year: number, seq: number): string {
  const yy = String(year % 100).padStart(2, "0");
  return `${TRANSFER_FORM.noPrefix}${yy}-${String(seq).padStart(TRANSFER_FORM.noDigits, "0")}`;
}

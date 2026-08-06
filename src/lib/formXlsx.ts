import { fillTemplate } from "./xlsxTemplate";
import { J426_TEMPLATE, J456_TEMPLATE } from "./templates/forms";
import { SINGLE_ASSIGNMENT_REASONS, type Reemployment, type Transfer } from "./types";

/**
 * 申請書を「指定帳票の Excel そのもの」で出す。
 *
 * 画面の印刷レイアウトは HTML で様式を似せているが、列幅・行高・罫線までは
 * 合わせきれず、環境によってずれる。原紙の xlsx に値を差し込めば様式は動かない。
 *
 * ここは**どのセルに何を書くか**の対応表。原紙を差し替えたら、
 * scripts/embed-forms.mts で埋め込み直したうえで、この表を見直すこと。
 */

const nz = (v: string | null | undefined): string => (v && v.trim() ? v.trim() : "");

/** "2026-08-06" → { y: "2026", m: "8", d: "6" }。空なら全部空。 */
function ymd(iso: string | null | undefined): { y: string; m: string; d: string } {
  const m = nz(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { y: "", m: "", d: "" };
  return { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) };
}

/** 改行つきの文字を、決められた行数のセルへ割り振る。あふれた分は最後の行にまとめる。 */
function toLines(text: string | null | undefined, rows: number): string[] {
  const src = nz(text).split(/\r?\n/);
  if (src.length <= rows) return [...src, ...Array(rows - src.length).fill("")];
  return [...src.slice(0, rows - 1), src.slice(rows - 1).join(" ")];
}

// ===== J-426(9) 異動申請書 ・ 組織名称追加変更申請書 =====

/**
 * チェック欄（Excel のフォームコントロール）の対応。
 *
 * どのコントロールがどの選択肢かは、原紙の VML に入っている
 * 「左上のセル」と、その右にある選択肢の文字から突き合わせた。
 * 同じ位置に2つ重ねてある枠（原紙の作りがそうなっている）は両方に印を付ける。
 *
 * **突き合わせが1つに決まらなかった欄は、ここに載せていない**。
 * 迷ったまま印を付けると帳票の意味が変わるため、その欄は Excel で手で付けてもらう。
 * （携帯の異動後、社用車の異動後、社用車駐車場、単身赴任事由④）
 */
const J426_CHECKS: { when: (t: Transfer) => boolean; names: string[] }[] = [
  // 【部門長間の合意】
  { when: (t) => t.deptAgreement === "済み", names: ["Check Box 13"] },
  { when: (t) => t.deptAgreement === "未決", names: ["Check Box 14"] },
  // 【転居】
  { when: (t) => t.relocation === "あり", names: ["Check Box 19"] },
  { when: (t) => t.relocation === "なし", names: ["Check Box 18"] },
  // 【携帯】
  { when: (t) => t.mobile === "あり", names: ["Check Box 21"] },
  { when: (t) => t.mobile === "なし", names: ["Check Box 20"] },
  // 【社用車】
  { when: (t) => t.companyCar === "あり", names: ["Check Box 33"] },
  { when: (t) => t.companyCar === "なし", names: ["Check Box 39"] },
  // 【異動前 住居】
  { when: (t) => t.housingBefore === "持家・個人契約", names: ["Check Box 1"] },
  { when: (t) => t.housingBefore === "社宅・会社契約", names: ["Check Box 2"] },
  { when: (t) => t.housingBefore === "実家", names: ["Check Box 3"] },
  // 【異動後 住居】※原紙は同じ位置に枠が2枚重なっている
  { when: (t) => t.housingAfter === "持家・個人契約", names: ["Check Box 4", "Check Box 15"] },
  { when: (t) => t.housingAfter === "社宅・会社契約", names: ["Check Box 5", "Check Box 16"] },
  { when: (t) => t.housingAfter === "実家", names: ["Check Box 6", "Check Box 17"] },
  // 【異動前 赴任形態】
  { when: (t) => t.assignmentBefore === "家族帯同", names: ["Check Box 7"] },
  { when: (t) => t.assignmentBefore === "独身", names: ["Check Box 8"] },
  { when: (t) => t.assignmentBefore === "単身赴任", names: ["Check Box 9"] },
  // 【異動後 赴任形態】※同上
  { when: (t) => t.assignmentAfter === "家族帯同", names: ["Check Box 10", "Check Box 26"] },
  { when: (t) => t.assignmentAfter === "独身", names: ["Check Box 11", "Check Box 24", "Check Box 27"] },
  { when: (t) => t.assignmentAfter === "単身赴任", names: ["Check Box 12", "Check Box 25"] },
  // <単身赴任 事由> ①〜③（④は原紙にチェック枠が無い）
  { when: (t) => t.singleReasons.includes(0), names: ["Check Box 28", "Check Box 29"] },
  { when: (t) => t.singleReasons.includes(1), names: ["Check Box 30"] },
  { when: (t) => t.singleReasons.includes(2), names: ["Check Box 31"] },
  // 【通勤経路変更】
  { when: (t) => t.commuteChange === "あり", names: ["Check Box 42"] },
  { when: (t) => t.commuteChange === "なし", names: ["Check Box 43"] },
  // 【本人への説明・合意】【後任の確認】
  { when: (t) => t.explainedAgreed, names: ["Check Box 44"] },
  { when: (t) => t.successorChecked, names: ["Check Box 45"] },
];

/** 手で付けてもらう欄（画面の案内に出す）。 */
export const J426_MANUAL_CHECKS = [
  "【携帯】の異動後（継続利用／不要／ガラケー⇔iphone）",
  "【社用車】の異動後（異動先で使用／別の社員が使用／不要／その他）",
  "【社用車駐車場】",
  "<単身赴任 事由> ④",
];

export function buildTransferXlsx(t: Transfer): Buffer {
  const created = ymd(t.formDate);
  const eff = ymd(t.effectiveDate);
  const arr = ymd(t.arrivalDate);
  const from = ymd(t.limitedFrom);
  const to = ymd(t.limitedTo);
  const reason = toLines(t.reason, 3);

  const cells: Record<string, string> = {
    // 右上 「西暦 ◯年 ◯月 ◯日 作成」
    Z1: created.y,
    AF1: created.m,
    AJ1: created.d,
    // 【対象社員】
    N7: nz(t.fromOrgUnitName),
    N8: t.employeeNo,
    N9: t.employeeName,
    // 【異動日付】／異動先赴任日
    H11: eff.y,
    N11: eff.m,
    R11: eff.d,
    AD11: arr.y,
    AJ11: arr.m,
    AN11: arr.d,
    // ※期間限定の場合
    H13: from.y,
    N13: from.m,
    R13: from.d,
    AD13: to.y,
    AJ13: to.m,
    AN13: to.d,
    // 【異動部署】現所属 → 異動先（部署・職務）
    L16: nz(t.fromOrgUnitName),
    AE16: nz(t.toOrgUnitName),
    L17: nz(t.fromDuty),
    AE17: nz(t.toDuty),
    // 【異動事由】3行
    H20: reason[0],
    H21: reason[1],
    H22: reason[2],
    // 【組織名称】変更前 → 追加・変更後
    J27: nz(t.orgNameBefore),
    Z27: nz(t.orgNameAfter),
    // 社用車「その他（　）」の中身
    AF38: nz(t.companyCarOther),
    // 情報ｼｽﾃﾑ部記入欄（部門コード・名称）
    M58: nz(t.systemDeptCode),
    AE58: nz(t.systemDeptName),
  };

  const checked = J426_CHECKS.filter((c) => c.when(t)).flatMap((c) => c.names);
  return fillTemplate(J426_TEMPLATE(), { cells, checked });
}

/** ダウンロードのファイル名。 */
export function transferXlsxName(t: Transfer): string {
  return `J-426_${t.transferNo}_${t.employeeName}.xlsx`;
}

// ===== J-456 継続雇用申請書 =====

/** "08:00" → "8:00"。原紙は時刻を文字で書く欄。 */
const hhmm = (v: string | null | undefined): string => nz(v).replace(/^0/, "");

function jpDate(iso: string | null | undefined): string {
  const d = ymd(iso);
  return d.y ? `${d.y}年${d.m}月${d.d}日` : "";
}

export function buildReemploymentXlsx(r: Reemployment): Buffer {
  const duties = toLines(r.duties.join("\n"), 3);
  // 理由は帳票の①〜④の見出しの下の行に入れる
  const reasons = [nz(r.reasons[0]), nz(r.reasons[1]), nz(r.reasons[2]), nz(r.reasons[3])];
  const hours =
    r.workStart && r.workEnd
      ? `${hhmm(r.workStart)} ～ ${hhmm(r.workEnd)}` +
        (r.breakHours != null ? `（休憩 ${r.breakHours} 時間）` : "")
      : "";
  const period =
    r.periodFrom || r.periodTo ? `${jpDate(r.periodFrom)} ～ ${jpDate(r.periodTo)}` : "";

  const cells: Record<string, string> = {
    // 対象者情報
    B5: r.employeeName,
    B6: nz(r.orgUnitName),
    B7: nz(r.currentEmploymentType),
    B8: jpDate(r.contractEndDate),
    // 申請内容
    B13: nz(r.employmentType),
    B14: period,
    B15: nz(r.workPlace),
    B16: r.daysPerWeek != null ? `週 ${r.daysPerWeek} 日` : "",
    B17: hours,
    // 業務内容 ①②③
    B18: duties[0] ? `① ${duties[0]}` : "① ",
    B19: duties[1] ? `② ${duties[1]}` : "② ",
    B20: duties[2] ? `③ ${duties[2]}` : "③",
    // 継続雇用の理由・必要性（見出しの下の行）
    A25: reasons[0],
    A28: reasons[1],
    A32: reasons[2],
    A36: reasons[3],
    // コンプライアンス確認・結論
    A39: nz(r.compliance),
    A43: nz(r.conclusion),
  };

  return fillTemplate(J456_TEMPLATE(), { cells });
}

export function reemploymentXlsxName(r: Reemployment): string {
  return `J-456_${r.docNo}_${r.employeeName}.xlsx`;
}

/** 帳票に出す単身赴任事由の文字（画面と揃える）。 */
export function singleReasonText(i: number): string {
  return SINGLE_ASSIGNMENT_REASONS[i] ?? "";
}

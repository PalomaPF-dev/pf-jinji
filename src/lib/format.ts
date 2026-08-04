/**
 * string | Date を "YYYY-MM-DD" に正規化。
 * pg ドライバが返す DATE（ローカル深夜の Date）は toISOString(UTC) だと前日にずれるため、
 * Date はローカルの暦日要素から組み立てる。
 */
export function toISODate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

/** "YYYY-MM-DD"（または ISO 文字列 / Date）を "2026年6月27日" 表記に。 */
export function formatDate(value: string | Date | null | undefined): string {
  const iso = toISODate(value);
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return String(value);
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** "YYYY-MM-DD" を "2026年6月" 表記に（給与の適用年月など、日を出さない場面用）。 */
export function formatYearMonth(value: string | Date | null | undefined): string {
  const iso = toISODate(value);
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  if (!y || !m) return String(value);
  return `${y}年${Number(m)}月`;
}

/** ISO 日時を "2026年7月6日 9:30" 表記に（formatDate と同じ年月日形式で統一）。 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const dt = value instanceof Date ? value : new Date(value);
  if (isNaN(dt.getTime())) return String(value);
  const jst = new Date(dt.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${jst.getUTCHours()}:${p(jst.getUTCMinutes())}`;
}

/** 金額を "¥285,000" 表記に。null は "—"。 */
export function formatYen(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

/**
 * 生年月日から基準日時点の満年齢を計算する。
 * 年齢は保存せず常にここで計算する（誕生日を跨いだ古い値が残らないようにするため）。
 */
export function ageAt(birthDate: string | Date | null | undefined, on: string): number | null {
  const iso = toISODate(birthDate);
  if (!iso) return null;
  const [by, bm, bd] = iso.split("-").map(Number);
  const [ny, nm, nd] = on.split("-").map(Number);
  if (!by || !ny) return null;
  let age = ny - by;
  if (nm < bm || (nm === bm && nd < bd)) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * 入社日から基準日時点の勤続年数を "12年3か月" 形式で返す。
 */
export function tenureAt(hireDate: string | Date | null | undefined, on: string): string {
  const iso = toISODate(hireDate);
  if (!iso) return "—";
  const [hy, hm, hd] = iso.split("-").map(Number);
  const [ny, nm, nd] = on.split("-").map(Number);
  if (!hy || !ny) return "—";
  let months = (ny - hy) * 12 + (nm - hm);
  if (nd < hd) months -= 1;
  if (months < 0) return "—";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return years > 0 ? `${years}年${rest}か月` : `${rest}か月`;
}

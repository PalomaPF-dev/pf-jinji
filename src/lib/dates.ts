/** 日付ユーティリティ（"YYYY-MM-DD" 文字列ベース）。 */

/** "YYYY-MM-DD" に N日足した日付を返す。 */
export function addDays(isoDate: string, days: number): string {
  const t = Date.parse(isoDate + "T00:00:00Z") + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" に Nか月足した日付を返す（月末日は丸める）。 */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}

/** today からの残り日数（負なら超過）。 */
export function daysUntil(targetDate: string, today: string): number {
  const a = Date.parse(targetDate + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  return Math.round((a - b) / 86_400_000);
}

/** サーバーのローカル日付を "YYYY-MM-DD"（JST基準）で返す。 */
export function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" をその月の1日に丸める（給与の適用開始年月は月初で運用する）。 */
export function firstOfMonth(isoDate: string): string {
  return isoDate.slice(0, 7) + "-01";
}

/**
 * 日本の年度（4月始まり）を返す。2026-03-31 → 2025年度、2026-04-01 → 2026年度。
 */
export function fiscalYearOf(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

/**
 * 年度内の上期/下期。4〜9月が上期(H1)、10〜3月が下期(H2)。
 */
export function fiscalHalfOf(isoDate: string): "H1" | "H2" {
  const m = Number(isoDate.split("-")[1]);
  return m >= 4 && m <= 9 ? "H1" : "H2";
}

/** ".env の ALERT_LEAD_DAYS"（例 "90,30,7"）を数値配列に。 */
export function alertLeadDays(): number[] {
  const raw = process.env.ALERT_LEAD_DAYS || "90,30,7";
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => b - a);
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 部署ごとの人員推移。
 *
 * ■ 何を数えるか
 *   その月末（今月は本日）時点で在籍していた人。休職・出向も**人員として数える**
 *   （籍はあるため）。退職者は退職日を過ぎた月から外れる。
 *
 * ■ 数え方の前提（画面にも注記を出すこと）
 *   - 所属は**現在の所属**で遡って数える。過去の所属の履歴は持っていないため、
 *     異動した人は異動後の部署の人数に、過去の月も含めて乗る。
 *   - 入社日が空の人は「ずっと在籍していた」として全月に数える。
 *   - 人事マスタの名簿は在籍者だけなので、退職者を取り込むまでは減少が出ない。
 *
 * ■ 部署の単位
 *   本部直下（工場・部・統括室）。職場まで割ると 190 行を超えて読めなくなるため。
 */
export interface HeadcountRow {
  orgId: string;
  name: string;
  /** 各月末の人数。labels と同じ長さ・同じ並び */
  counts: number[];
  /** 直近の人数 */
  current: number;
  /** 期間の最初からの増減 */
  delta: number;
}

export interface HeadcountTrend {
  /** 「2026-08」形式。表示は月だけにする */
  labels: string[];
  rows: HeadcountRow[];
  totals: number[];
}

/** 月末（今月だけは本日）の日付を古い順に返す。 */
export function monthEnds(today: string, months: number): { label: string; asOf: string }[] {
  const [y0, m0] = today.split("-").map(Number);
  const out: { label: string; asOf: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const t = y0 * 12 + (m0 - 1) - i;
    const y = Math.floor(t / 12);
    const m = (t % 12) + 1;
    const label = `${y}-${String(m).padStart(2, "0")}`;
    // 当月は「月末」がまだ来ていないので本日時点で数える
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ label, asOf: i === 0 ? today : `${label}-${String(lastDay).padStart(2, "0")}` });
  }
  return out;
}

/**
 * 部署ごとの人員推移を求める。
 * scopeOrgIds が指定されていれば、その範囲の部署だけ返す（工場スコープ）。
 */
export async function headcountTrend(opts: {
  today: string;
  months?: number;
  scopeOrgIds?: string[] | null;
}): Promise<HeadcountTrend> {
  await ensureSchema();
  const sql = getSql();
  const months = opts.months ?? 12;
  const scope = opts.scopeOrgIds ?? null;
  const points = monthEnds(opts.today, months);

  const [units, employees] = await Promise.all([
    sql`SELECT id, parent_id, name, sort, dept_code FROM jinji_org_units`,
    sql`SELECT org_unit_id, hire_date, retire_date, status FROM jinji_employees`,
  ]);

  const byId = new Map<string, any>(units.map((u: any) => [u.id as string, u]));
  const isRoot = (u: any) => !u.parent_id;

  /** その組織が属する「本部直下の部署」。本部そのもの・未配置は null。 */
  const deptOf = (orgId: string | null): any => {
    let u = orgId ? byId.get(orgId) : null;
    if (!u || isRoot(u)) return null;
    // 親が本部（＝根）になるまで遡る
    for (let i = 0; i < 20 && u; i++) {
      const p = u.parent_id ? byId.get(u.parent_id as string) : null;
      if (!p || isRoot(p)) return u;
      u = p;
    }
    return u ?? null;
  };

  // 同じ名前の部署枠が2つある（人事マスタ由来のグループと8桁の組織）ことがあるので、
  // 名前で1行に畳む。組織図・ポータル連携と同じ扱い。
  const normName = (v: string) => v.normalize("NFKC").replace(/[\s　]+/g, "").replace(/[ッｯ]/g, "");
  const idx = new Map<string, number>(); // 部署名 → rows の位置
  const rows: HeadcountRow[] = [];
  const totals = points.map(() => 0);

  const iso = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === "string") return v.slice(0, 10);
    return new Date(v as any).toISOString().slice(0, 10);
  };

  for (const e of employees as any[]) {
    const dept = deptOf((e.org_unit_id as string | null) ?? null);
    if (!dept) continue;
    if (scope && !scope.includes(dept.id as string)) continue;
    const hire = iso(e.hire_date);
    const retire = iso(e.retire_date);
    // 退職済みなのに退職日が無い人は、いつ抜けたか分からないのでどの月にも数えない
    if (e.status === "retired" && !retire) continue;

    const key = normName(dept.name as string);
    let at = idx.get(key);
    if (at === undefined) {
      at = rows.length;
      idx.set(key, at);
      rows.push({
        orgId: dept.id as string,
        name: dept.name as string,
        counts: points.map(() => 0),
        current: 0,
        delta: 0,
      });
    }
    for (let i = 0; i < points.length; i++) {
      const d = points[i].asOf;
      if (hire && hire > d) continue;
      if (retire && retire <= d) continue;
      rows[at].counts[i]++;
      totals[i]++;
    }
  }

  for (const r of rows) {
    r.current = r.counts[r.counts.length - 1] ?? 0;
    r.delta = r.current - (r.counts[0] ?? 0);
  }
  // 部署コード順（組織図・組織台帳と同じ並び）。コードが無いものは後ろ
  const codeOf = (id: string) => (byId.get(id)?.dept_code as string | null) ?? "￿";
  rows.sort((a, b) => codeOf(a.orgId).localeCompare(codeOf(b.orgId)) || a.name.localeCompare(b.name, "ja"));

  return { labels: points.map((p) => p.label), rows, totals };
}

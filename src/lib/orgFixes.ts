/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 一度だけ当てる組織の整備（調達部）。
 *
 * 実態はこの形なのに、本番では 14 名が調達部と調達室に直接ぶら下がっていて、
 * 企画グループ・管理グループの組織そのものが無い。
 *
 *   調達部
 *   └ 調達室 13361000        … 谷口 慶治（室長）
 *      ├ 企画グループ 13361500 … 5名
 *      └ 管理グループ 13361600 … 8名
 *
 * そこで **組織を用意し、社員番号で一人ずつ割り当てる**。
 * 割り当ての内容は人事マスタ（階層＋承認者のExcel）の所属組織コードそのもの。
 *
 * 安全のための条件:
 *   - 割り当てるのは、その人が**今も調達部の配下に居るとき**だけ。
 *     別の部署へ異動していたら触らない（過去の整備が現在の人事を上書きしない）。
 *   - 組織は職場コードで探し、無いときだけ作る。名前が変えられていても壊さない。
 *   - 何度流しても同じ結果になる。
 */

const SHITSU = "13361000"; // 調達室
const KIKAKU = "13361500"; // 企画グループ
const KANRI = "13361600"; // 管理グループ

/** 社員番号 → 落ち着き先の職場コード。人事マスタの所属組織コードそのまま。 */
const PLACEMENT: Record<string, string> = {
  "014272": SHITSU, // 谷口 慶治（係長・室長）
  "005142": KIKAKU, // 角田 一穂（課長）
  "007858": KIKAKU, // 町野 真一（係長）
  "010019": KIKAKU, // 近藤 三奈（係長心得）
  "014433": KIKAKU, // 伊藤 直史（主任）
  "016142": KIKAKU, // 髙橋 彩佳（一般）
  "012230": KANRI, // 一柳 絵美（課長心得・グループ長）
  "016102": KANRI, // 下久保 真希子（係長心得）
  "011599": KANRI, // 窪田 敦史（主任）
  "010007": KANRI, // 杉浦 慎二（主任）
  "014881": KANRI, // 大川 颯太（主任）
  "013611": KANRI, // 後藤 美咲（主任代理）
  "011297": KANRI, // 山北 裕香（主任代理）
  "015381": KANRI, // 近藤 友基（一般）
};

const NAME_OF: Record<string, string> = {
  [SHITSU]: "調達室",
  [KIKAKU]: "企画グループ",
  [KANRI]: "管理グループ",
};

export interface OrgFixResult {
  created: number;
  peopleMoved: number;
}

/** 調達部の階層を実態（調達部 → 調達室 → 企画/管理グループ）に合わせる。 */
export async function applyChotatsuStructure(sql: any): Promise<OrgFixResult> {
  const out: OrgFixResult = { created: 0, peopleMoved: 0 };

  // 対象の14名が今どこに居るか。1人でも居なければ、このデータには関係がない
  const nos = Object.keys(PLACEMENT);
  const people = await sql`
    SELECT e.id, e.employee_no, e.org_unit_id
    FROM jinji_employees e WHERE e.employee_no = ANY(${nos})`;
  if (people.length === 0) return out;

  // 「調達部」は、本部の直下にあって配下に人が居るほう（ポータル同期由来の空の枠は選ばない）
  const units = await sql`SELECT id, parent_id, name, code, workplace_code, dept_code FROM jinji_org_units`;
  const byId = new Map<string, any>(units.map((u: any) => [u.id as string, u]));
  const byWp = new Map<string, any>();
  for (const u of units as any[]) if (u.workplace_code) byWp.set(u.workplace_code as string, u);

  /** その組織が属する、本部直下の部署 */
  const deptOf = (orgId: string | null): any => {
    let u = orgId ? byId.get(orgId) : null;
    if (!u || !u.parent_id) return null;
    for (let i = 0; i < 20 && u; i++) {
      const p = u.parent_id ? byId.get(u.parent_id as string) : null;
      if (!p || !p.parent_id) return u;
      u = p;
    }
    return null;
  };

  // 14名の現在地から調達部を割り出す（名前ではなく実際の所属から辿るので、
  // 同名の枠が複数あっても取り違えない）
  const deptVotes = new Map<string, number>();
  for (const p of people as any[]) {
    const d = deptOf((p.org_unit_id as string | null) ?? null);
    if (d) deptVotes.set(d.id as string, (deptVotes.get(d.id as string) ?? 0) + 1);
  }
  const chotatsuId = [...deptVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!chotatsuId) return out;
  const chotatsu = byId.get(chotatsuId);

  /**
   * 職場コード（無ければ組織コード）で探し、名前と階層を整える。無ければ作る。
   *
   * ここで名前まで直すのが肝。既存の枠を使い回すだけだと、名前が親と同じ
   * （「調達部」のまま）のときに配置表が親の枠へ畳んでしまい、人は入っているのに
   * グループの枠が見えない、という状態になる。
   */
  const ensureOrg = async (code: string, parentId: string): Promise<string> => {
    const found =
      byWp.get(code) ?? (units as any[]).find((u) => (u.code as string) === code) ?? null;
    if (found) {
      await sql`
        UPDATE jinji_org_units
        SET name = ${NAME_OF[code]}, parent_id = ${parentId}, workplace_code = ${code},
            dept_code = COALESCE(dept_code, ${chotatsu?.dept_code ?? null}), updated_at = NOW()
        WHERE id = ${found.id}`;
      byWp.set(code, { id: found.id, workplace_code: code });
      return found.id as string;
    }
    const made = await sql`
      INSERT INTO jinji_org_units (parent_id, code, name, kind, workplace_code, dept_code)
      VALUES (${parentId}, ${code}, ${NAME_OF[code]}, ${"ka"}, ${code}, ${chotatsu?.dept_code ?? null})
      RETURNING id`;
    const id = made[0]?.id as string;
    out.created++;
    byWp.set(code, { id, workplace_code: code });
    return id;
  };

  const shitsuId = await ensureOrg(SHITSU, chotatsuId);
  const orgIdByCode: Record<string, string> = {
    [SHITSU]: shitsuId,
    [KIKAKU]: await ensureOrg(KIKAKU, shitsuId),
    [KANRI]: await ensureOrg(KANRI, shitsuId),
  };

  // 割り当て。今も調達部の配下に居る人だけ動かす
  const targets: { id: string; org: string }[] = [];
  for (const p of people as any[]) {
    const now = (p.org_unit_id as string | null) ?? null;
    const dept = deptOf(now);
    if (!dept || dept.id !== chotatsuId) continue; // 別の部署へ移っていたら触らない
    const want = orgIdByCode[PLACEMENT[p.employee_no as string]];
    if (!want || want === now) continue;
    targets.push({ id: p.id as string, org: want });
  }
  if (targets.length > 0) {
    const done = await sql`
      UPDATE jinji_employees e SET org_unit_id = v.org, updated_at = NOW()
      FROM unnest(${targets.map((t) => t.id)}::uuid[], ${targets.map((t) => t.org)}::uuid[]) AS v(id, org)
      WHERE e.id = v.id
      RETURNING e.id`;
    out.peopleMoved = done.length;
  }
  return out;
}

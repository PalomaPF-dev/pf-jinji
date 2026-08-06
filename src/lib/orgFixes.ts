/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 一度だけ当てる組織の整備。
 *
 * 人事マスタの名簿は「調達部 調達室 企画ｸﾞﾙｰﾌﾟ」のように、階層を名前に畳み込んで
 * 持っている。そのまま取り込むと調達部の直下に長い名前の枠が2つ並び、
 * 実態（調達部 → 調達室 → 各グループ）と組織図が食い違う。
 *
 *   調達部
 *   └ 調達室            … 室長
 *      ├ 企画グループ
 *      └ 管理グループ
 *
 * 画面（配置表の編集）からも同じことはできるが、本番の組織図を実態に合わせる
 * ところまでを持っていきたいので、版を上げた最初の1回だけここで直す。
 *
 * 突合は**職場コード**で行う（名前は直す対象なので鍵にできない）。
 * すでに直っていれば何もしない。人が別の形に整えていたらそれを壊さない。
 */

const KIKAKU = "13361500"; // 企画グループ
const KANRI = "13361600"; // 管理グループ
const SHITSU = "13361000"; // 調達室（新設。人事マスタに番号が無いので調達部の系列で振る）
const SHITSUCHO = "014272"; // 谷口 慶治（室長）。調達室付けにする

export interface OrgFixResult {
  created: number;
  moved: number;
  renamed: number;
  peopleMoved: number;
}

/** 調達部の階層を実態（調達部 → 調達室 → 企画/管理グループ）に合わせる。 */
export async function applyChotatsuStructure(sql: any): Promise<OrgFixResult> {
  const out: OrgFixResult = { created: 0, moved: 0, renamed: 0, peopleMoved: 0 };

  const groups = await sql`
    SELECT id, name, parent_id, workplace_code
    FROM jinji_org_units
    WHERE workplace_code IN (${KIKAKU}, ${KANRI})`;
  if (groups.length === 0) return out; // このデータには無い（開発環境など）

  // 直す対象が残っているか。名前が既に短ければ、人が整えたあとなので触らない
  const stale = groups.filter((g: any) => /調達室/.test(g.name as string));
  if (stale.length === 0) return out;

  // 調達部（＝グループたちの現在の親）。ここに調達室をぶら下げる
  const parentId = (stale[0].parent_id as string | null) ?? null;
  if (!parentId) return out;

  let shitsu = (
    await sql`SELECT id FROM jinji_org_units WHERE workplace_code = ${SHITSU} OR name = ${"調達室"} LIMIT 1`
  )[0]?.id as string | undefined;

  if (!shitsu) {
    const made = await sql`
      INSERT INTO jinji_org_units (parent_id, code, name, kind, workplace_code, dept_code)
      SELECT ${parentId}, ${SHITSU}, ${"調達室"}, ${"ka"}, ${SHITSU}, dept_code
      FROM jinji_org_units WHERE id = ${parentId}
      RETURNING id`;
    shitsu = made[0]?.id as string;
    out.created = 1;
  }
  if (!shitsu) return out;

  for (const [code, name] of [
    [KIKAKU, "企画グループ"],
    [KANRI, "管理グループ"],
  ] as const) {
    const done = await sql`
      UPDATE jinji_org_units
      SET name = ${name}, parent_id = ${shitsu}, updated_at = NOW()
      WHERE workplace_code = ${code} AND name LIKE ${"%調達室%"}
      RETURNING id`;
    if (done.length > 0) {
      out.renamed += done.length;
      out.moved += done.length;
    }
  }

  // 室長は調達室付け。グループに居るときだけ動かす（別の所属に変わっていたら触らない）
  const person = await sql`
    UPDATE jinji_employees e SET org_unit_id = ${shitsu}, updated_at = NOW()
    FROM jinji_org_units o
    WHERE o.id = e.org_unit_id
      AND e.employee_no = ${SHITSUCHO}
      AND o.workplace_code IN (${KIKAKU}, ${KANRI})
    RETURNING e.id`;
  out.peopleMoved = person.length;

  return out;
}

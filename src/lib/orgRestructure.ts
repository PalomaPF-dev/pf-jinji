import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { normalizeOrgName } from "./hrMasterImport";

/**
 * 組織名称から中間層を組み立てる（本部 → 工場/部 → 職場/室）。
 *
 * 人事システムの名簿は「本部（4桁）→ 所属組織（8桁）」の2階層しか持たないが、
 * 8桁組織の名称が「大口工場 ﾌﾟﾚｽ1」「生産管理部 生産企画室」のように
 * **先頭の語で工場・部を名乗っている**。この規則を使って中間層を作り、
 * 職場・室をその下へぶら下げる。
 *
 * 規則:
 *  - 名称が空白で区切られ、先頭の語が「〜工場」「〜部」→ その語が中間層
 *  - 「本社工場長」「大口工場長代理」のような単語名 → 「〜工場」部分が中間層
 *  - 中間層と同名の組織が既にあれば（「可児工場」「生産管理部」等）、それを親として使う
 *  - どれにも当てはまらない名称（EHS統括室・配送センター等）は本部直下のまま
 *
 * 何度実行しても同じ結果になる（取込のたびに呼んでよい）。
 * 人が組織図で動かした組織は、この規則に一致しない限り触らない。
 */

/**
 * 先頭の語が部署の略称になっている組織の受け皿。
 *
 * 名簿は「調達 専門部品グループ」のように**部署名を略して**先頭に付けることがある。
 * 「〜部」「〜工場」で終わらないため上の規則から外れ、本部の直下に平らに並んでしまう。
 * そこで略称ごとに「どの部署の、どの室の下に置くか」を決めておく。
 *
 * 先頭の略称は名前から落とす（「調達 専門部品グループ」→「専門部品グループ」）。
 * 部署の下に室が並ぶ形になるので、接頭辞は重複でしかないため。
 */
const PREFIX_RULES: { prefix: string; dept: string; middle: string }[] = [
  { prefix: "調達", dept: "調達部", middle: "調達室" },
];

/** 名称から中間層の名前を求める。中間層を作らない名称は null。 */
export function groupKeyOf(name: string): string | null {
  const tokens = name.split(/[\s　]+/).filter(Boolean);
  if (tokens.length >= 2) {
    const head = tokens[0];
    // 「本庄配送ｾﾝﾀｰ 本庄工場」のように先頭が工場・部でないものは対象外
    return /(工場|部)$/.test(head) ? head : null;
  }
  // 「本社工場長」「大口工場長付」「直方工場長代理」→ 工場に属する
  const m = name.match(/^(.+工場)長(付|代理)?$/);
  return m ? m[1] : null;
}

export interface RestructureResult {
  /** 新しく作った中間層の数 */
  middlesCreated: number;
  /** 親を付け替えた組織の数 */
  moved: number;
  /** 接頭辞を落として改称した組織の数 */
  renamed: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 名簿由来（8桁コード）の組織へ規則を適用する。
 * まとめて読んでまとめて書く（リモートDBで往復を増やさないため）。
 */
export async function restructureOrgByName(): Promise<RestructureResult> {
  await ensureSchema();
  const sql = getSql();
  const result: RestructureResult = { middlesCreated: 0, moved: 0, renamed: 0 };

  const units = await sql`SELECT id, code, name, parent_id FROM jinji_org_units`;
  const byId = new Map(units.map((u: any) => [u.id as string, u]));
  // 同名の判定は表記ゆれ（半角カナ・小さいッ）を吸収して行う。
  // 人事マスタ側は「ロジスティクス部」、名簿側は「ﾛｼﾞｽﾃｨｸｽ部」のように揺れるため。
  const byName = new Map<string, any[]>();
  for (const u of units) {
    const key = normalizeOrgName(u.name as string);
    const list = byName.get(key) ?? [];
    list.push(u);
    byName.set(key, list);
  }

  /** 最上位の祖先（中間層の親にする本部）。循環しても止まる。 */
  const rootOf = (u: any): any => {
    const seen = new Set<string>();
    let cur = u;
    while (cur.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const p = byId.get(cur.parent_id);
      if (!p) break;
      cur = p;
    }
    return cur;
  };

  // 8桁コードの組織を、名称の規則でグループ分けする。
  // 対象は**本部直下に平らに置かれている組織だけ**。すでに深い階層に居る組織は、
  // 人事マスタの取込や手作業で組まれた配置なので触らない（取り合いを防ぐ）。
  const isFlat = (u: any): boolean => {
    if (!u.parent_id) return true;
    const parent = byId.get(u.parent_id);
    return !parent || !parent.parent_id;
  };
  const leaves = units.filter((u: any) => /^\d{8}$/.test(u.code as string) && isFlat(u));
  const needed = new Map<string, { rootId: string | null; leaf: any[] }>();
  for (const leaf of leaves) {
    const key = groupKeyOf(leaf.name as string);
    if (!key || key === leaf.name) continue; // 中間層そのもの・対象外は動かさない
    const rootId = rootOf(leaf).id as string;
    const g = needed.get(key) ?? { rootId, leaf: [] };
    g.leaf.push(leaf);
    needed.set(key, g);
  }
  if (needed.size === 0) {
    await applyPrefixRules(sql, result);
    return result;
  }

  // 中間層を用意する。同名の組織が既にあればそれを使い、無ければ作る。
  // 自前で作るものには衝突しない合成コード（AUTO-名称）を振る。
  const toCreate: { code: string; name: string; kind: string; parentId: string | null }[] = [];
  const middleIdByKey = new Map<string, string>();
  for (const [key, g] of needed) {
    // 同じ本部の配下にある同名組織だけを親候補にする。
    // ポータル同期由来の「第二工場」「調達部」など、別系統の同名組織を
    // 親に使うと、職場が本部の外へ移ってしまう。
    // 同じ本部配下の候補のうち、部署（AUTO- 等）を8桁の所属組織より優先する。
    // 「ﾛｼﾞｽﾃｨｸｽ部」のように部署と同名の8桁組織があるとき、8桁側を親にすると
    // 人事マスタ取込（部署を親にする）と取り込むたびに親が入れ替わってしまうため。
    const existing =
      (byName.get(normalizeOrgName(key)) ?? [])
        .filter((c) => rootOf(c).id === g.rootId)
        .sort(
          (a, b) =>
            (/^\d{8}$/.test(a.code as string) ? 1 : 0) - (/^\d{8}$/.test(b.code as string) ? 1 : 0),
        )[0] ?? null;
    if (existing) {
      middleIdByKey.set(key, existing.id as string);
    } else {
      toCreate.push({
        code: `AUTO-${key}`,
        name: key,
        kind: key.endsWith("工場") ? "factory" : "bu",
        parentId: g.rootId,
      });
    }
  }
  if (toCreate.length > 0) {
    await sql`
      INSERT INTO jinji_org_units (code, name, kind, parent_id)
      SELECT * FROM unnest(
        ${toCreate.map((x) => x.code)}::text[],
        ${toCreate.map((x) => x.name)}::text[],
        ${toCreate.map((x) => x.kind)}::text[],
        ${toCreate.map((x) => x.parentId)}::uuid[]
      )
      ON CONFLICT (code) DO NOTHING`;
    const created = await sql`
      SELECT id, name FROM jinji_org_units WHERE code = ANY(${toCreate.map((x) => x.code)}::text[])`;
    for (const c of created) middleIdByKey.set(c.name as string, c.id as string);
    result.middlesCreated = toCreate.length;
  }

  // 付け替え。既に正しい親の下にいる組織は触らない
  const moveIds: string[] = [];
  const moveParents: string[] = [];
  for (const [key, g] of needed) {
    const middleId = middleIdByKey.get(key);
    if (!middleId) continue;
    for (const leaf of g.leaf) {
      if (leaf.id === middleId) continue;
      if (leaf.parent_id === middleId) continue;
      moveIds.push(leaf.id as string);
      moveParents.push(middleId);
    }
  }
  if (moveIds.length > 0) {
    await sql`
      UPDATE jinji_org_units o
      SET parent_id = v.pid
      FROM unnest(${moveIds}::uuid[], ${moveParents}::uuid[]) AS v(id, pid)
      WHERE o.id = v.id`;
    result.moved = moveIds.length;
  }

  await applyPrefixRules(sql, result);
  return result;
}

/**
 * 略称が先頭に付いた組織を、部署 → 室 の下へ入れて接頭辞を落とす。
 * 取込のたびに呼ばれる（名簿は毎回もとの長い名前で入ってくるため）。
 */
async function applyPrefixRules(sql: any, result: RestructureResult): Promise<void> {
  for (const rule of PREFIX_RULES) {
    // 「調達 ◯◯」だけを拾う。「調達部」そのもの・「調達室」は対象外
    const head = new RegExp(`^${rule.prefix}[\\s　]+`);
    const units: any[] = await sql`SELECT id, parent_id, code, name FROM jinji_org_units`;
    const targets = units.filter((u) => head.test(u.name as string));
    if (targets.length === 0) continue;

    // 受け皿の部署。同名があればそれを使い、無ければ作る
    const norm = (v: string) => normalizeOrgName(v);
    const dept =
      units.find((u) => norm(u.name as string) === norm(rule.dept)) ??
      (
        await sql`
          INSERT INTO jinji_org_units (code, name, kind, parent_id)
          VALUES (${`AUTO-${rule.dept}`}, ${rule.dept}, ${"bu"},
                  ${(targets[0].parent_id as string | null) ?? null})
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, parent_id, code, name`
      )[0];
    if (!dept) continue;

    // 部署と室のあいだの室。無ければ作る
    const middle =
      units.find((u) => norm(u.name as string) === norm(rule.middle)) ??
      (
        await sql`
          INSERT INTO jinji_org_units (code, name, kind, parent_id)
          VALUES (${`AUTO-${rule.middle}`}, ${rule.middle}, ${"ka"}, ${dept.id})
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, parent_id, code, name`
      )[0];
    if (!middle) continue;
    if (middle.parent_id !== dept.id) {
      await sql`UPDATE jinji_org_units SET parent_id = ${dept.id} WHERE id = ${middle.id}`;
    }

    // 接頭辞を落として室の下へ
    const ids: string[] = [];
    const names: string[] = [];
    for (const t of targets) {
      const short = (t.name as string).replace(head, "").trim();
      if (!short) continue;
      if (t.name === short && t.parent_id === middle.id) continue;
      ids.push(t.id as string);
      names.push(short);
    }
    if (ids.length > 0) {
      await sql`
        UPDATE jinji_org_units o
        SET name = v.name, parent_id = ${middle.id}, updated_at = NOW()
        FROM unnest(${ids}::uuid[], ${names}::text[]) AS v(id, name)
        WHERE o.id = v.id`;
      result.renamed += ids.length;
      result.moved += ids.length;
    }
  }
}

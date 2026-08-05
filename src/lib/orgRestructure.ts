import { getSql } from "./neon";
import { ensureSchema } from "./schema";

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
 * 人が /org/edit で動かした組織は、この規則に一致しない限り触らない。
 */

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
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 名簿由来（8桁コード）の組織へ規則を適用する。
 * まとめて読んでまとめて書く（リモートDBで往復を増やさないため）。
 */
export async function restructureOrgByName(): Promise<RestructureResult> {
  await ensureSchema();
  const sql = getSql();
  const result: RestructureResult = { middlesCreated: 0, moved: 0 };

  const units = await sql`SELECT id, code, name, parent_id FROM jinji_org_units`;
  const byId = new Map(units.map((u: any) => [u.id as string, u]));
  const byName = new Map<string, any[]>();
  for (const u of units) {
    const list = byName.get(u.name as string) ?? [];
    list.push(u);
    byName.set(u.name as string, list);
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

  // 8桁コードの組織を、名称の規則でグループ分けする
  const leaves = units.filter((u: any) => /^\d{8}$/.test(u.code as string));
  const needed = new Map<string, { rootId: string | null; leaf: any[] }>();
  for (const leaf of leaves) {
    const key = groupKeyOf(leaf.name as string);
    if (!key || key === leaf.name) continue; // 中間層そのもの・対象外は動かさない
    const rootId = rootOf(leaf).id as string;
    const g = needed.get(key) ?? { rootId, leaf: [] };
    g.leaf.push(leaf);
    needed.set(key, g);
  }
  if (needed.size === 0) return result;

  // 中間層を用意する。同名の組織が既にあればそれを使い、無ければ作る。
  // 自前で作るものには衝突しない合成コード（AUTO-名称）を振る。
  const toCreate: { code: string; name: string; kind: string; parentId: string | null }[] = [];
  const middleIdByKey = new Map<string, string>();
  for (const [key, g] of needed) {
    // 同じ本部の配下にある同名組織だけを親候補にする。
    // ポータル同期由来の「第二工場」「調達部」など、別系統の同名組織を
    // 親に使うと、職場が本部の外へ移ってしまう。
    const candidates = byName.get(key) ?? [];
    const existing = candidates.find((c) => rootOf(c).id === g.rootId) ?? null;
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
  return result;
}

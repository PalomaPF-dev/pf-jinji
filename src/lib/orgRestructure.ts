import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { normalizeOrgName } from "./hrMasterImport";

/**
 * 名簿（賞与マスタ）から組織図の階層を組み立てる。
 *
 * 名簿が持つのは「組織コード２（4桁＝本部）」と「所属組織コード（8桁＝職場）」の
 * 2階層だけで、部・工場・室にあたる中間層が入っていない。人事マスタの「階層」シートと
 * 突き合わせると、**8桁コードの上位4桁が部・工場を表している**ことが分かるので、
 * それを手掛かりに次の4階層へ組み直す。
 *
 *   第1階層 本部          生産・調達統括本部
 *   第2階層 部・工場      大口工場 / 調達部 / ロジスティクス部 …
 *   第3階層 室・共通・総務 大口安全推進工場長室 / 大口組立共通 / 大口総務 / 調達室 …
 *   第4階層 それ以外の職場 大口ﾌﾟﾚｽ1 / 大口品質管理 / 大江配送センター …
 *
 * 工場長・工場長代理・工場長付は工場の直下に残す（配置表で工場の枠へ統合されるため）。
 *
 * 何度実行しても同じ結果になる（取込のたびに呼んでよい）。
 * 8桁コードを持たない組織（配置表で人が足したもの）は、第3階層の受け皿として
 * 使う場合を除いて動かさない。
 */

/**
 * 上位4桁が違っても同じ部に属するもの。
 *
 * 配送センター・ロジスティクスセンター（1441…）は人事マスタの部署コードでは
 * ロジスティクス部（1341…）に属している。コードだけでは結び付かないのでここで寄せる。
 */
const GROUP_ALIASES: Record<string, string> = { "1441": "1341" };

/**
 * 先頭の語が部署の略称になっている組織の受け皿。
 *
 * 名簿は「調達 専門部品グループ」のように**部署名を略して**先頭に付けることがある。
 * 8桁コードの上位4桁では部までしか分からず、間の室が作られないため、
 * 略称ごとに「どの部の、どの室の下に置くか」を決めておく。
 *
 * 先頭の略称は名前から落とす（「調達 専門部品グループ」→「専門部品グループ」）。
 * 部の下に室が並ぶ形になるので、接頭辞は重複でしかないため。
 */
const PREFIX_RULES: { prefix: string; dept: string; middle: string }[] = [
  { prefix: "調達", dept: "調達部", middle: "調達室" },
];

/** 第3階層に置く組織か（室・共通・総務）。 */
export function isLevel3Name(name: string): boolean {
  return /(室|共通|総務)$/.test(name.replace(/[\s　]+$/, ""));
}

/** 工場の長にあたる組織か（工場の枠へ統合するので中間層を挟まない）。 */
function isFactoryHeadName(name: string): boolean {
  return /工場長(代理|付)?$/.test(name.replace(/[\s　]+/g, ""));
}

/** 「大口工場長代理」→「大口工場」。工場名が読み取れなければ null。 */
function factoryNameOf(name: string): string | null {
  const m = name.replace(/[\s　]+/g, "").match(/^(.+工場)長(代理|付)?$/);
  return m ? m[1] : null;
}

/** 文字列の共通の先頭。中間層の名前が他から読み取れないときの最後の手掛かり。 */
function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let p = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < p.length && i < n.length && p[i] === n[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}

export interface RestructureResult {
  /** 新しく作った中間層（部・工場・室）の数 */
  middlesCreated: number;
  /** 親を付け替えた組織の数 */
  moved: number;
  /** 接頭辞を落として改称した組織の数 */
  renamed: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Unit {
  id: string;
  code: string;
  name: string;
  kind: string;
  parent_id: string | null;
  dept_code: string | null;
  workplace_code: string | null;
}

/**
 * 名簿由来（8桁コード）の組織へ規則を適用する。
 * まとめて読んでまとめて書く（リモートDBで往復を増やさないため）。
 */
export async function restructureOrgByName(): Promise<RestructureResult> {
  await ensureSchema();
  const sql = getSql();
  const result: RestructureResult = { middlesCreated: 0, moved: 0, renamed: 0 };

  // 略称の受け皿（調達部→調達室）を先に用意する。ここで作った室は
  // このあとの階層付けで「第3階層の枠」として使われる。
  await applyPrefixRules(sql, result);

  const units: Unit[] = (
    await sql`SELECT id, code, name, kind, parent_id, dept_code, workplace_code FROM jinji_org_units`
  ).map((u: any) => ({
    id: u.id as string,
    code: u.code as string,
    name: u.name as string,
    kind: u.kind as string,
    parent_id: (u.parent_id as string | null) ?? null,
    dept_code: (u.dept_code as string | null) ?? null,
    workplace_code: (u.workplace_code as string | null) ?? null,
  }));
  const byId = new Map(units.map((u) => [u.id, u]));

  /** 最上位の祖先（本部）。循環しても止まる。 */
  const rootOf = (u: Unit): Unit => {
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

  // ===== 8桁コードの職場を「本部 × 上位4桁」でまとめる =====
  const leaves = units.filter((u) => /^\d{8}$/.test(u.code));
  const groups = new Map<string, { rootId: string; key: string; members: Unit[] }>();
  for (const leaf of leaves) {
    const raw = leaf.code.slice(0, 4);
    const key = GROUP_ALIASES[raw] ?? raw;
    const rootId = rootOf(leaf).id;
    const gk = `${rootId}/${key}`;
    const g = groups.get(gk) ?? { rootId, key, members: [] };
    g.members.push(leaf);
    groups.set(gk, g);
  }

  // ===== 第2階層（部・工場）の枠を決める =====
  const parentOf = new Map<string, string>(); // 動かす組織 → 新しい親
  const codeOf = new Map<string, { dept?: string; wp?: string }>(); // 組織 → 埋めるコード
  const toCreate: { key: string; code: string; name: string; kind: string; parentId: string }[] = [];
  const frameByGroup = new Map<string, { unit?: Unit; createKey?: string }>();

  for (const [gk, g] of groups) {
    // (1) 部そのもの（上位4桁 + "1000"）が名簿に居ればそれが枠
    const self = g.members.find((m) => m.code === `${g.key}1000`);
    if (self) {
      frameByGroup.set(gk, { unit: self });
      if (self.parent_id !== g.rootId) parentOf.set(self.id, g.rootId);
      continue;
    }
    // (2) 「◯◯工場長」から工場名を読む
    let name: string | null = null;
    for (const m of g.members) {
      const f = factoryNameOf(m.name);
      if (f) {
        name = f;
        break;
      }
    }
    // (3) それも無ければ職場名の共通の先頭から「◯◯工場」を立てる。
    //     取り違えを防ぐため、2文字以上の共通部分が3職場以上にあるときだけ。
    if (!name && g.members.length >= 3) {
      const p = commonPrefix(g.members.map((m) => m.name)).replace(/[\s　]+$/, "");
      if (p.length >= 2) name = `${p}工場`;
    }
    if (!name) continue; // 名前を決められない系統は触らない

    const existing = units.find(
      (u) => normalizeOrgName(u.name) === normalizeOrgName(name!) && rootOf(u).id === g.rootId,
    );
    if (existing) {
      frameByGroup.set(gk, { unit: existing });
      if (existing.parent_id !== g.rootId) parentOf.set(existing.id, g.rootId);
    } else {
      const code = `AUTO-${name}`;
      toCreate.push({
        key: gk,
        code,
        name,
        kind: name.endsWith("工場") ? "factory" : "bu",
        parentId: g.rootId,
      });
      frameByGroup.set(gk, { createKey: code });
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
      SELECT id, code, name, kind, parent_id FROM jinji_org_units
      WHERE code = ANY(${toCreate.map((x) => x.code)}::text[])`;
    const byCode = new Map(created.map((c: any) => [c.code as string, c]));
    for (const t of toCreate) {
      const row: any = byCode.get(t.code);
      if (!row) continue;
      const u: Unit = {
        id: row.id as string,
        code: row.code as string,
        name: row.name as string,
        kind: row.kind as string,
        parent_id: (row.parent_id as string | null) ?? null,
        dept_code: null,
        workplace_code: null,
      };
      units.push(u);
      byId.set(u.id, u);
      frameByGroup.set(t.key, { unit: u });
    }
    result.middlesCreated += toCreate.length;
  }

  // ===== 第3階層（室・共通・総務）と第4階層（それ以外）=====
  for (const [gk, g] of groups) {
    const frame = frameByGroup.get(gk)?.unit;
    if (!frame) continue;

    const members = g.members.filter((m) => m.id !== frame.id);

    // 第3階層の枠。名簿由来のものに加えて、枠の直下に人が足した室（調達室など）も使う。
    const level3: Unit[] = members.filter((m) => isLevel3Name(m.name));
    for (const u of units) {
      if (/^\d{8}$/.test(u.code)) continue;
      if (u.parent_id !== frame.id) continue;
      if (!isLevel3Name(u.name)) continue;
      level3.push(u);
    }

    // 第4階層の受け皿。工場は安全推進工場長室、無ければコードの若い枠。
    const receiver =
      level3.find((u) => /安全推進/.test(u.name)) ??
      [...level3].sort((a, b) => a.code.localeCompare(b.code))[0] ??
      null;

    for (const m of members) {
      // 工場長・工場長代理・工場長付は工場の直下（配置表で工場の枠に統合される）
      if (isFactoryHeadName(m.name)) {
        if (m.parent_id !== frame.id) parentOf.set(m.id, frame.id);
        continue;
      }
      if (level3.some((l) => l.id === m.id)) {
        if (m.parent_id !== frame.id) parentOf.set(m.id, frame.id);
        continue;
      }
      const want = receiver ? receiver.id : frame.id;
      if (m.parent_id !== want) parentOf.set(m.id, want);
    }
    // 人が足した室も、枠の直下に居ることを保つ
    for (const l of level3) {
      if (l.parent_id !== frame.id) parentOf.set(l.id, frame.id);
    }

    // 組織図に出すコードを埋める。
    //   職場コード … 所属組織コード（8桁）そのもの
    //   部署コード … その系統の上位4桁（1212=大口工場、1336=調達部…）
    // 人事マスタ（階層シート）を取り込むと、より正確な部署コードで上書きされる。
    // すでに値が入っている組織は触らない。
    for (const m of [frame, ...members]) {
      if (/^\d{8}$/.test(m.code) && !m.workplace_code) codeOf.set(m.id, { wp: m.code });
      if (!m.dept_code) {
        const prev = codeOf.get(m.id) ?? {};
        codeOf.set(m.id, { ...prev, dept: g.key });
      }
    }
  }

  // ===== まとめて付け替え（親が先祖に居ない＝輪にならないことを確かめてから）=====
  const nextParent = (id: string): string | null =>
    parentOf.get(id) ?? byId.get(id)?.parent_id ?? null;
  const makesCycle = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let cur = nextParent(id);
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = nextParent(cur);
    }
    return false;
  };
  const ids: string[] = [];
  const pids: string[] = [];
  for (const [id, pid] of parentOf) {
    if (makesCycle(id)) continue;
    ids.push(id);
    pids.push(pid);
  }
  if (ids.length > 0) {
    await sql`
      UPDATE jinji_org_units o
      SET parent_id = v.pid, updated_at = NOW()
      FROM unnest(${ids}::uuid[], ${pids}::uuid[]) AS v(id, pid)
      WHERE o.id = v.id`;
    result.moved += ids.length;
  }

  // コードの穴埋め。COALESCE で「すでに入っている値」を優先する
  const cIds = [...codeOf.keys()];
  if (cIds.length > 0) {
    await sql`
      UPDATE jinji_org_units o
      SET dept_code = COALESCE(o.dept_code, v.dept),
          workplace_code = COALESCE(o.workplace_code, v.wp)
      FROM unnest(
        ${cIds}::uuid[],
        ${cIds.map((id) => codeOf.get(id)?.dept ?? null)}::text[],
        ${cIds.map((id) => codeOf.get(id)?.wp ?? null)}::text[]
      ) AS v(id, dept, wp)
      WHERE o.id = v.id
        AND (o.dept_code IS NULL OR o.workplace_code IS NULL)`;
  }

  return result;
}

/**
 * 略称が先頭に付いた組織を、部 → 室 の下へ入れて接頭辞を落とす。
 * 取込のたびに呼ばれる（名簿は毎回もとの長い名前で入ってくるため）。
 */
async function applyPrefixRules(sql: any, result: RestructureResult): Promise<void> {
  for (const rule of PREFIX_RULES) {
    // 「調達 ◯◯」だけを拾う。「調達部」そのもの・「調達室」は対象外
    const head = new RegExp(`^${rule.prefix}[\\s　]+`);
    const units: any[] = await sql`SELECT id, parent_id, code, name FROM jinji_org_units`;
    const targets = units.filter((u) => head.test(u.name as string));

    // 受け皿の部。同名があればそれを使う。無いときは、改名する組織があるときだけ作る
    // （名簿にその部が居ない環境で、勝手に部を生やさないため）。
    const norm = (v: string) => normalizeOrgName(v);
    const dept =
      units.find((u) => norm(u.name as string) === norm(rule.dept)) ??
      (targets.length === 0
        ? null
        : (
            await sql`
          INSERT INTO jinji_org_units (code, name, kind, parent_id)
          VALUES (${`AUTO-${rule.dept}`}, ${rule.dept}, ${"bu"},
                  ${(targets[0].parent_id as string | null) ?? null})
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, parent_id, code, name`
          )[0]);
    if (!dept) continue;

    // 部と職場のあいだの室。無ければ作る
    const middle =
      units.find((u) => norm(u.name as string) === norm(rule.middle)) ??
      (targets.length === 0
        ? null
        : (
            await sql`
          INSERT INTO jinji_org_units (code, name, kind, parent_id)
          VALUES (${`AUTO-${rule.middle}`}, ${rule.middle}, ${"ka"}, ${dept.id})
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, parent_id, code, name`
          )[0]);
    if (!middle) continue;
    // 室は必ず部の直下に置く。名簿側の名前がすでに短くなっていて改名するものが
    // 無いときでも、ここだけは掛け直す（室が部から外れると階層が崩れるため）。
    if (middle.parent_id !== dept.id) {
      await sql`UPDATE jinji_org_units SET parent_id = ${dept.id} WHERE id = ${middle.id}`;
      middle.parent_id = dept.id;
      result.moved++;
    }
    if (targets.length === 0) continue;

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

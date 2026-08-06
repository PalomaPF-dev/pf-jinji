import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { normalizeOrgKind, type OrgKind, type OrgNode, type OrgUnit } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ===== 行マッピング =====

function mapOrgUnit(r: any): OrgUnit {
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    code: r.code,
    name: r.name,
    kind: normalizeOrgKind(r.kind),
    sort: Number(r.sort ?? 0),
    headEmployeeId: r.head_employee_id ?? null,
    portalDeptCode: r.portal_dept_code ?? null,
    portalWorkplaceCode: r.portal_workplace_code ?? null,
    deptCode: r.dept_code ?? null,
    workplaceCode: r.workplace_code ?? null,
    description: r.description ?? null,
    validFrom: toISODate(r.valid_from),
    validTo: toISODate(r.valid_to),
  };
}

// ===== 取得 =====

/** 組織単位を全件（並び順つき）。 */
export async function listOrgUnits(): Promise<OrgUnit[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM jinji_org_units ORDER BY sort ASC, name ASC`;
  return rows.map(mapOrgUnit);
}

export async function getOrgUnit(id: string): Promise<OrgUnit | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM jinji_org_units WHERE id = ${id} LIMIT 1`;
  return rows[0] ? mapOrgUnit(rows[0]) : null;
}

/**
 * 基準日時点で有効な組織単位だけを返す。
 * valid_from / valid_to が未設定の行は「常に有効」として扱う（運用開始時の手間を減らすため）。
 */
export function activeOn(units: OrgUnit[], asOf: string): OrgUnit[] {
  return units.filter(
    (u) => (!u.validFrom || u.validFrom <= asOf) && (!u.validTo || u.validTo >= asOf),
  );
}

/**
 * 組織ツリーを組む。
 *
 * - 親が（基準日の絞り込みなどで）居ない子は、根として扱う＝組織図から消えない
 * - totalCount は配下すべてを含む在籍者数
 * - 親子が循環していても無限ループしない（訪問済みは打ち切る）
 */
export function buildOrgTree(
  units: OrgUnit[],
  memberCounts: Map<string, number>,
  headNames: Map<string, string>,
): OrgNode[] {
  const byId = new Map<string, OrgNode>();
  for (const u of units) {
    byId.set(u.id, {
      ...u,
      children: [],
      memberCount: memberCounts.get(u.id) ?? 0,
      totalCount: 0,
      headName: u.headEmployeeId ? (headNames.get(u.headEmployeeId) ?? null) : null,
      depth: 0,
    });
  }

  const roots: OrgNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // 自分自身を親にしている行は根として扱う（データ不整合の保険）
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (list: OrgNode[]) => {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "ja"));
    for (const n of list) sortNodes(n.children);
  };
  sortNodes(roots);

  const visited = new Set<string>();
  const walk = (node: OrgNode, depth: number): number => {
    if (visited.has(node.id)) {
      node.children = [];
      return 0;
    }
    visited.add(node.id);
    node.depth = depth;
    let total = node.memberCount;
    for (const c of node.children) total += walk(c, depth + 1);
    node.totalCount = total;
    return total;
  };
  for (const r of roots) walk(r, 0);

  return roots;
}

/** 組織ツリーを「階層インデント付きの一次元リスト」に潰す（セレクトボックス用）。 */
export function flattenTree(nodes: OrgNode[]): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (list: OrgNode[]) => {
    for (const n of list) {
      out.push({ id: n.id, label: n.name, depth: n.depth });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * ある組織自身と、その配下すべての id を返す。
 * 上位組織の選択肢からこれらを外すために使う（自分の子を親にすると木が壊れるため）。
 * サーバー側 updateOrgUnit でも同じ条件を弾くが、選ばせない方が親切なので画面でも使う。
 */
export function selfAndDescendantIds(nodes: OrgNode[], id: string): Set<string> {
  const out = new Set<string>();
  const collect = (n: OrgNode) => {
    out.add(n.id);
    for (const c of n.children) collect(c);
  };
  const find = (list: OrgNode[]): boolean => {
    for (const n of list) {
      if (n.id === id) {
        collect(n);
        return true;
      }
      if (find(n.children)) return true;
    }
    return false;
  };
  find(nodes);
  return out;
}

/** 組織単位ごとの在籍者数（status='active'）。 */
export async function memberCountsByOrg(): Promise<Map<string, number>> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT org_unit_id, count(*)::int AS n
    FROM jinji_employees
    WHERE status = 'active' AND org_unit_id IS NOT NULL
    GROUP BY org_unit_id`;
  return new Map(rows.map((r) => [r.org_unit_id as string, r.n as number]));
}

/** 上長表示用に「社員ID → 氏名」を引く。 */
export async function employeeNamesById(): Promise<Map<string, string>> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT id, name FROM jinji_employees`;
  return new Map(rows.map((r) => [r.id as string, r.name as string]));
}

/** 組織図1枚分のデータをまとめて取得する。 */
export async function loadOrgChart(asOf: string): Promise<OrgNode[]> {
  const [units, counts, names] = await Promise.all([
    listOrgUnits(),
    memberCountsByOrg(),
    employeeNamesById(),
  ]);
  return buildOrgTree(activeOn(units, asOf), counts, names);
}

// ===== 更新 =====

export interface OrgUnitInput {
  code: string;
  name: string;
  kind: OrgKind;
  parentId: string | null;
  sort: number;
  headEmployeeId: string | null;
  description: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** 人事マスタの部署コード（工場・部のグループ） */
  deptCode?: string | null;
  /** 人事マスタの職場コード（所属組織コード・8桁）。ポータル連携の突合キー */
  workplaceCode?: string | null;
}

/**
 * コードの重複を弾く。
 *
 * 組織コード（code）は DB のユニーク制約が守るが、職場コードはポータル連携の
 * 突合キーになるので、ここで重ならないことを確かめる。重複したまま連携すると
 * ポータルの職場が1つに潰れる。
 */
async function assertCodesFree(input: OrgUnitInput, selfId: string | null): Promise<void> {
  const sql = getSql();
  const dup = await sql`
    SELECT name FROM jinji_org_units
    WHERE (code = ${input.code}
           OR (${input.workplaceCode ?? null}::text IS NOT NULL AND workplace_code = ${input.workplaceCode ?? null}))
      AND (${selfId}::uuid IS NULL OR id <> ${selfId})
    LIMIT 1`;
  if (dup[0]) {
    throw new Error(`同じコードの組織「${dup[0].name}」があります。コードは組織ごとに違う値にしてください。`);
  }
}

export async function createOrgUnit(input: OrgUnitInput): Promise<string> {
  await ensureSchema();
  await assertCodesFree(input, null);
  const sql = getSql();
  const rows = await sql`
    INSERT INTO jinji_org_units
      (parent_id, code, name, kind, sort, head_employee_id, description, valid_from, valid_to,
       dept_code, workplace_code)
    VALUES (${input.parentId}, ${input.code}, ${input.name}, ${input.kind}, ${input.sort},
            ${input.headEmployeeId}, ${input.description}, ${input.validFrom}, ${input.validTo},
            ${input.deptCode ?? null}, ${input.workplaceCode ?? null})
    RETURNING id`;
  return rows[0].id as string;
}

/**
 * 組織単位を更新する。
 * 自分自身や自分の子孫を親に指定すると木が壊れるため、ここで弾く。
 */
export async function updateOrgUnit(id: string, input: OrgUnitInput): Promise<void> {
  await ensureSchema();
  if (input.parentId && (await isDescendantOrSelf(input.parentId, id))) {
    throw new Error("自分自身や配下の組織を上位組織には指定できません。");
  }
  await assertCodesFree(input, id);
  const sql = getSql();
  await sql`
    UPDATE jinji_org_units SET
      parent_id = ${input.parentId},
      code = ${input.code},
      name = ${input.name},
      kind = ${input.kind},
      sort = ${input.sort},
      head_employee_id = ${input.headEmployeeId},
      description = ${input.description},
      valid_from = ${input.validFrom},
      valid_to = ${input.validTo},
      dept_code = ${input.deptCode ?? null},
      workplace_code = ${input.workplaceCode ?? null},
      updated_at = NOW()
    WHERE id = ${id}`;
}

/** candidate が root の子孫（または root 自身）か。親を辿って判定する。 */
async function isDescendantOrSelf(candidate: string, root: string): Promise<boolean> {
  if (candidate === root) return true;
  const sql = getSql();
  const seen = new Set<string>([candidate]);
  let cursor: string | null = candidate;
  while (cursor) {
    const rows: any[] = await sql`SELECT parent_id FROM jinji_org_units WHERE id = ${cursor} LIMIT 1`;
    const parent = (rows[0]?.parent_id as string | null) ?? null;
    if (!parent) return false;
    if (parent === root) return true;
    if (seen.has(parent)) return false; // 既存データが循環していても止まる
    seen.add(parent);
    cursor = parent;
  }
  return false;
}

/**
 * 組織単位を削除する。
 *
 * 所属している社員が居る場合は消さない（所属不明の社員が生まれると人事マスターとして
 * 成立しないため）。配下の組織がある場合も消さない。FK は ON DELETE SET NULL なので
 * 消せてしまうが、配下が黙って「最上位」に浮き上がり、組織図が崩れたことに気づけない。
 */
export async function deleteOrgUnit(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT count(*)::int AS n FROM jinji_employees WHERE org_unit_id = ${id}`;
  if ((rows[0]?.n as number) > 0) {
    throw new Error("この組織には所属者がいます。先に異動させてから削除してください。");
  }
  const kids = await sql`SELECT count(*)::int AS n FROM jinji_org_units WHERE parent_id = ${id}`;
  if ((kids[0]?.n as number) > 0) {
    throw new Error(
      `この組織には配下の組織が ${kids[0].n} 件あります。先に配下を別の組織へ移すか削除してください。`,
    );
  }
  await sql`DELETE FROM jinji_org_units WHERE id = ${id}`;
}

// ===== ポータル部署マスターの取込 =====

interface PortalDepartment {
  id: string;
  code: string;
  kind: "dept" | "factory" | null;
  name: string;
  description: string;
  sort: number;
}

interface PortalWorkplace {
  id: string;
  departmentId: string;
  code: string;
  name: string;
  sort: number;
}

export interface PortalSyncResult {
  created: number;
  updated: number;
  /** ポータル側に無くなった（が人事側には残っている）組織 */
  orphans: string[];
}

function portalBaseUrl(): string {
  return (process.env.PORTAL_BASE_URL || "https://portal.paloma-pf.com").replace(/\/+$/, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ポータルからの取得に失敗しました（${res.status}）: ${url}`);
  return (await res.json()) as T;
}

/** 使われていない組織コードを作る（ポータルのコードが人事側で既に使われている場合の逃げ道）。 */
async function uniqueCode(base: string): Promise<string> {
  const sql = getSql();
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const rows = await sql`SELECT 1 FROM jinji_org_units WHERE code = ${candidate} LIMIT 1`;
    if (rows.length === 0) return candidate;
  }
  throw new Error(`組織コード ${base} の重複を解消できませんでした。`);
}

/**
 * ポータルの部署マスター（公開GET）を取り込み、組織ツリーへ反映する。
 *
 * 取り込むのは**名称と存在**まで。階層（parent_id）・並び順・上長・種別は人事側の
 * 資産なので、既存行では**一切上書きしない**。ポータルで名前が変わったときだけ追随する。
 * 新規行に限り、ポータルの部署→職場の関係を初期の親子として入れる。
 *
 * ポータルから消えた組織はこちらでは削除しない（所属者が居る可能性があるため）。
 * 呼び出し側に orphans として返し、画面で気づけるようにする。
 */
export async function syncPortalOrgUnits(): Promise<PortalSyncResult> {
  await ensureSchema();
  const sql = getSql();
  const base = portalBaseUrl();

  const [departments, workplaces] = await Promise.all([
    fetchJson<PortalDepartment[]>(`${base}/api/departments`),
    fetchJson<PortalWorkplace[]>(`${base}/api/workplaces`).catch(() => [] as PortalWorkplace[]),
  ]);

  let created = 0;
  let updated = 0;
  // ポータルの部署UUID → 人事側の組織ID（職場の親を解決するため）
  const deptIdToOrgId = new Map<string, string>();
  const seenPortalCodes = new Set<string>();

  for (const d of departments) {
    if (!d.code) continue;
    seenPortalCodes.add(d.code);
    const existing = await sql`
      SELECT id, name FROM jinji_org_units WHERE portal_dept_code = ${d.code} LIMIT 1`;
    if (existing.length > 0) {
      const id = existing[0].id as string;
      deptIdToOrgId.set(d.id, id);
      if ((existing[0].name as string) !== d.name) {
        await sql`UPDATE jinji_org_units SET name = ${d.name}, updated_at = NOW() WHERE id = ${id}`;
        updated++;
      }
      continue;
    }
    // 新規: 工場は 'factory'、それ以外は '部' 相当として置き、階層は人事側で組み直す
    const kind: OrgKind = d.kind === "factory" ? "factory" : "bu";
    const code = await uniqueCode(d.code);
    const rows = await sql`
      INSERT INTO jinji_org_units (code, name, kind, sort, description, portal_dept_code)
      VALUES (${code}, ${d.name}, ${kind}, ${Number(d.sort ?? 0)}, ${d.description || null}, ${d.code})
      RETURNING id`;
    deptIdToOrgId.set(d.id, rows[0].id as string);
    created++;
  }

  for (const w of workplaces) {
    if (!w.code) continue;
    seenPortalCodes.add(w.code);
    const existing = await sql`
      SELECT id, name FROM jinji_org_units WHERE portal_workplace_code = ${w.code} LIMIT 1`;
    if (existing.length > 0) {
      const id = existing[0].id as string;
      if ((existing[0].name as string) !== w.name) {
        await sql`UPDATE jinji_org_units SET name = ${w.name}, updated_at = NOW() WHERE id = ${id}`;
        updated++;
      }
      continue;
    }
    const parentId = deptIdToOrgId.get(w.departmentId) ?? null;
    const code = await uniqueCode(w.code);
    await sql`
      INSERT INTO jinji_org_units (parent_id, code, name, kind, sort, portal_workplace_code)
      VALUES (${parentId}, ${code}, ${w.name}, ${"workplace"}, ${Number(w.sort ?? 0)}, ${w.code})`;
    created++;
  }

  // ポータル由来なのにポータル側に見当たらなくなったもの
  const linked = await sql`
    SELECT name, portal_dept_code, portal_workplace_code
    FROM jinji_org_units
    WHERE portal_dept_code IS NOT NULL OR portal_workplace_code IS NOT NULL`;
  const orphans = linked
    .filter((r) => {
      const code = (r.portal_dept_code as string | null) ?? (r.portal_workplace_code as string | null);
      return code != null && !seenPortalCodes.has(code);
    })
    .map((r) => r.name as string);

  return { created, updated, orphans };
}

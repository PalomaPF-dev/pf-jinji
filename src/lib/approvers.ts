import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { dutyRank, positionRank } from "./orgChart";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 申請書の承認者を決める。
 *
 *   部門長 … 申請部署（対象者の所属）が属する**部・工場**の長を自動で当てる
 *   役員   … 社員番号で指定する（部署から機械的には決まらないため）
 *
 * 部門長を名前で探さないのは、肩書きが「部門長」「工場長A」「本部長」と揺れるため。
 * 代わりに**組織図で部・工場の枠の先頭に来る人**を採る。枠の並びは職務→役職の
 * 序列で決めていて、これは現場で「その部署の長は誰か」と一致する。
 * 組織に「組織の長（head_employee_id）」が設定してあれば、そちらを優先する。
 */

export interface ApproverRef {
  employeeNo: string;
  name: string;
}

/** 社員番号から承認者を引く。居なければ null。 */
export async function findApproverByNo(employeeNo: string): Promise<ApproverRef | null> {
  const no = employeeNo.trim();
  if (!no) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT employee_no, name FROM jinji_employees
    WHERE employee_no = ${no} AND status <> 'retired' LIMIT 1`;
  if (rows.length === 0) return null;
  return { employeeNo: rows[0].employee_no as string, name: rows[0].name as string };
}

/**
 * その所属が属する「部・工場」（本部の直下）の長を返す。
 *
 * 1. 所属から親を辿って、本部の直下＝部・工場の枠を見つける
 * 2. その枠に組織の長が設定してあればそれ
 * 3. 無ければ、枠に居る人（工場長・工場長代理などの統合分を含む）のうち
 *    職務→役職の序列がいちばん上の人
 */
export async function findDeptHead(orgUnitId: string | null): Promise<ApproverRef | null> {
  if (!orgUnitId) return null;
  await ensureSchema();
  const sql = getSql();

  const units: any[] = await sql`SELECT id, parent_id, name, head_employee_id FROM jinji_org_units`;
  const byId = new Map(units.map((u) => [u.id as string, u]));

  // 本部の直下（＝部・工場）まで遡る
  let cur = byId.get(orgUnitId);
  if (!cur) return null;
  const seen = new Set<string>();
  while (cur?.parent_id && !seen.has(cur.id as string)) {
    seen.add(cur.id as string);
    const parent = byId.get(cur.parent_id as string);
    if (!parent) break;
    if (!parent.parent_id) break; // 親が本部＝ここが部・工場
    cur = parent;
  }
  const frame = cur;
  if (!frame) return null;

  // 組織の長が設定してあればそれを使う
  if (frame.head_employee_id) {
    const head = await sql`
      SELECT employee_no, name FROM jinji_employees
      WHERE id = ${frame.head_employee_id} AND status <> 'retired' LIMIT 1`;
    if (head.length > 0) {
      return { employeeNo: head[0].employee_no as string, name: head[0].name as string };
    }
  }

  // 枠に居る人（「◯◯工場長」のように枠へ統合される組織の人も含める）
  const frameName = (frame.name as string) ?? "";
  const memberOrgIds = [frame.id as string];
  for (const u of units) {
    if (u.parent_id !== frame.id) continue;
    const n = ((u.name as string) ?? "").replace(/[\s　]+/g, "");
    const p = frameName.replace(/[\s　]+/g, "");
    if (n === p || (n.startsWith(p) && /^長(代理|付)?$/.test(n.slice(p.length)))) {
      memberOrgIds.push(u.id as string);
    }
  }

  const people = await sql`
    SELECT employee_no, name, position_name, duty_name
    FROM jinji_employees
    WHERE org_unit_id = ANY(${memberOrgIds}::uuid[]) AND status <> 'retired'`;
  if (people.length === 0) return null;

  const sorted = [...people].sort(
    (a: any, b: any) =>
      dutyRank(a.duty_name) - dutyRank(b.duty_name) ||
      positionRank(a.position_name) - positionRank(b.position_name) ||
      String(a.name).localeCompare(String(b.name), "ja"),
  );
  const top = sorted[0] as any;
  return { employeeNo: top.employee_no as string, name: top.name as string };
}

/**
 * 承認欄に担当者を割り当てる。
 * 値が決まらなかった枠は空のまま（誰でも押せる従来どおりの扱いに戻る）。
 */
export async function assignApprovers(
  table: "jinji_transfer_approvals" | "jinji_reemployment_approvals",
  idColumn: "transfer_id" | "reemployment_id",
  docId: string,
  assignments: { slot: string; approver: ApproverRef | null }[],
): Promise<void> {
  const sql = getSql();
  for (const a of assignments) {
    if (table === "jinji_transfer_approvals") {
      await sql`
        UPDATE jinji_transfer_approvals
        SET assignee_login_id = ${a.approver?.employeeNo ?? null},
            assignee_name = ${a.approver?.name ?? null}
        WHERE transfer_id = ${docId} AND slot = ${a.slot}`;
    } else {
      await sql`
        UPDATE jinji_reemployment_approvals
        SET assignee_login_id = ${a.approver?.employeeNo ?? null},
            assignee_name = ${a.approver?.name ?? null}
        WHERE reemployment_id = ${docId} AND slot = ${a.slot}`;
    }
  }
  void idColumn;
}

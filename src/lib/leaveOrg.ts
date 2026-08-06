/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 「長欠」の職場に居る人は**休職**として数える。
 *
 * 人事マスタでは、長期欠勤の人を工場ごとの「◯◯工場 長欠」という職場へ移して
 * 管理している。名簿にはそれ以外の在籍区分の欄が無いため、そのまま取り込むと
 * 全員が「在籍」になり、実際に働いている人数と食い違う。
 *
 * そこで**所属が長欠の職場なら在籍状態を休職にする**。取込のたびに掛け直すので、
 * 名簿で長欠へ移った人は次の取込で休職になる。
 *
 * 逆（休職→在籍）は自動では戻さない。長欠の職場に居ない休職者（私傷病・育休など）を
 * 在籍に書き戻してしまうため。長欠から戻った人は異動の発令か社員カードで直す。
 */
export const LEAVE_ORG_PATTERN = "%長欠%";

/** 長欠の職場に居る在籍者を休職にする。戻り値は変えた人数。 */
export async function applyLeaveByOrgName(sql: any): Promise<number> {
  const rows = await sql`
    UPDATE jinji_employees e SET status = 'leave', updated_at = NOW()
    FROM jinji_org_units o
    WHERE o.id = e.org_unit_id
      AND o.name LIKE ${LEAVE_ORG_PATTERN}
      AND e.status = 'active'
    RETURNING e.id`;
  return rows.length;
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 兼務。本務（jinji_employees.org_unit_id）とは別に持つ「もう一つの所属」。
 *
 * 人事システムの名簿は1人1所属しか持てないので、兼務は人事側で足す。
 * 本務と同じ列に入れず別テーブルにしてあるのは、
 *  - 名簿を取り込み直しても兼務が消えないようにするため
 *  - 人数を二重に数えないため（在籍者数・部署別人数は本務だけで数える）
 * の2つ。組織図の配置表には「兼」印を付けて出す。
 */

export interface ConcurrentPost {
  id: string;
  employeeId: string;
  orgUnitId: string;
  orgUnitName: string;
  positionName: string | null;
  dutyName: string | null;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
}

export interface ConcurrentPostInput {
  employeeId: string;
  orgUnitId: string;
  positionName: string | null;
  dutyName: string | null;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
}

function map(r: any): ConcurrentPost {
  return {
    id: r.id as string,
    employeeId: r.employee_id as string,
    orgUnitId: r.org_unit_id as string,
    orgUnitName: (r.org_unit_name as string | null) ?? "",
    positionName: (r.position_name as string | null) ?? null,
    dutyName: (r.duty_name as string | null) ?? null,
    startedOn: toISODate(r.started_on),
    endedOn: toISODate(r.ended_on),
    note: (r.note as string | null) ?? null,
  };
}

/** その社員の兼務。組織名を付けて返す。 */
export async function listConcurrentPosts(employeeId: string): Promise<ConcurrentPost[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT c.*, o.name AS org_unit_name
    FROM jinji_concurrent_posts c
    LEFT JOIN jinji_org_units o ON o.id = c.org_unit_id
    WHERE c.employee_id = ${employeeId}
    ORDER BY c.started_on NULLS LAST, o.name`;
  return rows.map(map);
}

export function validateConcurrentPost(input: ConcurrentPostInput, homeOrgId: string | null): string | null {
  if (!input.orgUnitId) return "兼務先の組織を選んでください。";
  if (homeOrgId && input.orgUnitId === homeOrgId) {
    return "本務と同じ組織は兼務にできません。";
  }
  if (input.startedOn && input.endedOn && input.startedOn > input.endedOn) {
    return "終了日は開始日より後にしてください。";
  }
  return null;
}

/** 兼務を足す。同じ組織への二重登録はエラーにする。 */
export async function addConcurrentPost(input: ConcurrentPostInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO jinji_concurrent_posts
      (employee_id, org_unit_id, position_name, duty_name, started_on, ended_on, note)
    VALUES (${input.employeeId}, ${input.orgUnitId}, ${input.positionName}, ${input.dutyName},
            ${input.startedOn}, ${input.endedOn}, ${input.note})`;
}

/** 兼務を消す。誰の兼務かを渡して、他人のものを消せないようにする。 */
export async function deleteConcurrentPost(id: string, employeeId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM jinji_concurrent_posts WHERE id = ${id} AND employee_id = ${employeeId}`;
}

/** 兼務を持っている社員のID。一覧で「兼」を出すのに使う。 */
export async function employeeIdsWithConcurrentPost(): Promise<Set<string>> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT DISTINCT employee_id FROM jinji_concurrent_posts`;
  return new Set(rows.map((r: any) => r.employee_id as string));
}

export interface ConcurrentMember {
  employeeId: string;
  employeeNo: string;
  name: string;
  orgUnitId: string;
  positionName: string | null;
  dutyName: string | null;
}

/**
 * 基準日に有効な兼務を、組織図に出すための形で全件返す。
 * 役職・職務は兼務側に入っていればそれを、無ければ本務の値を使う。
 */
export async function listConcurrentMembers(asOf: string): Promise<ConcurrentMember[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT c.org_unit_id, e.id, e.employee_no, e.name,
           COALESCE(c.position_name, e.position_name) AS position_name,
           COALESCE(c.duty_name, e.duty_name)         AS duty_name
    FROM jinji_concurrent_posts c
    JOIN jinji_employees e ON e.id = c.employee_id
    WHERE e.status <> 'retired'
      AND (c.started_on IS NULL OR c.started_on <= ${asOf})
      AND (c.ended_on   IS NULL OR c.ended_on   >= ${asOf})
    ORDER BY (e.name_kana IS NULL), e.name_kana ASC, e.employee_no ASC`;
  return rows.map((r: any) => ({
    employeeId: r.id as string,
    employeeNo: r.employee_no as string,
    name: r.name as string,
    orgUnitId: r.org_unit_id as string,
    positionName: (r.position_name as string | null) ?? null,
    dutyName: (r.duty_name as string | null) ?? null,
  }));
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { listTransferItems } from "./transfers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 一括異動申請の**別紙（異動者一覧）**の行。
 * 実物の一覧表の列（工場名・異動日・個人コード・個人氏名・所属コード・総所属・
 * 新所属組織コード・新所属組織名・理由）に合わせている。
 */
export interface AppendixRow {
  /** 工場名（「大口工場」→「大口」のように末尾の「工場」を省いた呼び名） */
  factory: string;
  /** 異動日（8月1日 のような表記） */
  effectiveDate: string;
  employeeNo: string;
  employeeName: string;
  /** 現所属の8桁コード */
  fromCode: string;
  /** 総所属（本部からの名称の連なり） */
  fromPath: string;
  toCode: string;
  toName: string;
  reason: string;
}

export const APPENDIX_HEADERS = [
  "工場名",
  "異動日",
  "個人コード",
  "個人氏名（姓 名）",
  "所属コード",
  "総所属コード",
  "新所属組織コード",
  "新所属組織名",
  "理由",
] as const;

const jpDate = (iso: string | null): string => {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(m)}月${Number(d)}日`;
};

/** 別紙の行を組み立てる。並びは申請時の登録順。 */
export async function buildAppendixRows(transferId: string): Promise<AppendixRow[]> {
  await ensureSchema();
  const sql = getSql();
  const [items, units] = await Promise.all([
    listTransferItems(transferId),
    sql`SELECT id, parent_id, name FROM jinji_org_units`,
  ]);
  const byId = new Map(units.map((u: any) => [u.id as string, u]));

  /** 根 → 対象組織 の名称の連なりと、本部直下の祖先名。 */
  const pathOf = (orgId: string | null): { path: string; top: string } => {
    if (!orgId) return { path: "", top: "" };
    const chain: any[] = [];
    const seen = new Set<string>();
    let cur = byId.get(orgId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    chain.reverse(); // 根 → 葉
    const top = chain.length >= 2 ? (chain[1].name as string) : ((chain[0]?.name as string) ?? "");
    return { path: chain.map((u) => u.name as string).join(""), top };
  };

  return items.map((i) => {
    const from = pathOf(i.fromOrgUnitId);
    return {
      factory: from.top.replace(/工場$/, ""),
      effectiveDate: jpDate(i.effectiveDate),
      employeeNo: i.employeeNo,
      employeeName: i.employeeName,
      fromCode: i.fromOrgUnitCode ?? "",
      fromPath: from.path,
      toCode: i.toOrgUnitCode ?? "",
      toName: i.toOrgUnitName ?? "",
      reason: i.reason ?? "",
    };
  });
}

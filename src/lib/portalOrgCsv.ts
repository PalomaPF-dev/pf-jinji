import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { isFactoryOrg, mergesIntoParent } from "./orgChart";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ポータルの「CSVで一括設定」にそのまま入る形で、部署・職場の一覧を書き出す。
 *
 * ■ なぜ連携で送らずCSVにするか
 *   部署にどのアプリを割り当てるかはポータルの運用で、人事は口を出さない。
 *   一方で「どんな部・工場・職場があるか」は人事が持っている。
 *   そこで**一覧だけを渡して、設定はポータルでしてもらう**という分け方にした。
 *   連携で部署を作ると、ポータル側の設定を人事が上書きしてしまう。
 *
 * ■ 対応づけ
 *   ポータルの部署 … 人事の第2階層（部・工場）。コードは部署コード（4桁）
 *   ポータルの職場 … 人事の第3・第4階層。コードは職場コード（8桁）
 *
 *   「大口工場長」のように工場の枠へ統合される組織は職場にしない
 *   （配置表でも工場の枠に統合しているため、職場として出すと二重になる）。
 *
 * ■ アプリ列を出さない理由
 *   ポータルの取込は「アプリ列が無ければ既存の割当を維持」する。
 *   列ごと出さないことで、取り込み直してもアプリ割当が消えない。
 */

export interface PortalOrgRow {
  /** 部・工場のコード（4桁） */
  departmentCode: string;
  /** 部・工場の名前 */
  departmentName: string;
  isFactory: boolean;
  sort: number;
}

export interface PortalWorkplaceRow {
  departmentCode: string;
  /** 職場のコード（8桁） */
  code: string;
  name: string;
  sort: number;
}

export interface PortalOrgExport {
  departments: PortalOrgRow[];
  workplaces: PortalWorkplaceRow[];
  /** コードが無いために出せなかった組織（画面で知らせる） */
  skipped: { name: string; reason: string }[];
}

export async function buildPortalOrgExport(): Promise<PortalOrgExport> {
  await ensureSchema();
  const sql = getSql();
  const units: any[] = await sql`
    SELECT id, parent_id, name, dept_code, workplace_code, code, sort
    FROM jinji_org_units`;
  const byId = new Map(units.map((u) => [u.id as string, u]));

  const departments: PortalOrgRow[] = [];
  const workplaces: PortalWorkplaceRow[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const u of units) {
    const parent = u.parent_id ? byId.get(u.parent_id as string) : null;
    if (!parent) continue; // 本部そのもの。ポータルには出さない

    const name = (u.name as string) ?? "";
    if (!parent.parent_id) {
      // ===== 第2階層＝部・工場 → ポータルの部署 =====
      const code = (u.dept_code as string | null) ?? null;
      if (!code) {
        skipped.push({ name, reason: "部署コードが未設定です" });
        continue;
      }
      departments.push({
        departmentCode: code,
        departmentName: name,
        isFactory: isFactoryOrg(name),
        sort: Number(u.sort ?? 0),
      });
      continue;
    }

    // ===== それより下＝職場 =====
    // 部・工場の枠まで遡って、所属する部署コードを決める
    let frame: any = u;
    const seen = new Set<string>();
    while (frame?.parent_id && !seen.has(frame.id as string)) {
      seen.add(frame.id as string);
      const p = byId.get(frame.parent_id as string);
      if (!p) break;
      if (!p.parent_id) break; // 親が本部＝frame が部・工場
      frame = p;
    }
    // 工場の枠へ統合される組織（「大口工場長」など）は職場として出さない
    if (mergesIntoParent(frame.name as string, name)) continue;

    const departmentCode = (frame.dept_code as string | null) ?? null;
    const code = (u.workplace_code as string | null) ?? null;
    if (!departmentCode || !code) {
      skipped.push({
        name,
        reason: !departmentCode ? "上位の部署コードが未設定です" : "職場コードが未設定です",
      });
      continue;
    }
    workplaces.push({ departmentCode, code, name, sort: Number(u.sort ?? 0) });
  }

  const byCode = (a: { code?: string; departmentCode: string }, b: { code?: string; departmentCode: string }) =>
    (a.code ?? a.departmentCode).localeCompare(b.code ?? b.departmentCode);
  departments.sort(byCode);
  workplaces.sort(byCode);
  return { departments, workplaces, skipped };
}

/** CSVの1セル。カンマ・引用符・改行を含むときだけ引用する。 */
function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  // Excel が UTF-8 と分かるよう BOM を付ける（付けないと日本語が化ける）
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/**
 * 部署CSV。ポータルの「① 職場設定 → CSVで一括設定」に入る形。
 * アプリ列は**出さない**（既存の割当を維持させるため）。
 */
export function departmentsCsv(x: PortalOrgExport): string {
  return toCsv([
    ["部署コード", "種別", "部署名", "説明", "並び順"],
    ...x.departments.map((d, i) => [
      d.departmentCode,
      d.isFactory ? "工場" : "部署",
      d.departmentName,
      "",
      i + 1,
    ]),
  ]);
}

/** 職場CSV。ポータルの「職場CSVで一括設定」に入る形。 */
export function workplacesCsv(x: PortalOrgExport): string {
  return toCsv([
    ["部署コード", "職場コード", "職場名", "並び順"],
    ...x.workplaces.map((w, i) => [w.departmentCode, w.code, w.name, i + 1]),
  ]);
}

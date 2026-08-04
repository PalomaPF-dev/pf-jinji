import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { toISODate } from "./format";
import { normalizeEmploymentStatus, type EmploymentStatus } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PF人事管理 → ポータルへの人事情報連携（push）。
 *
 * ■ どちらがマスターか
 *   人事管理が「人」のマスター。誰がどこに所属し、何の役職で、いつ入社したか。
 *   ポータルは「アカウント」のマスター。ログインID・パスワード・アプリ権限（role /
 *   can_manage / apps 割当）・承認者。
 *
 *   したがってこの連携は**人事情報だけを一方向に送る**。パスワードや権限は
 *   一切送らないし、上書きもしない（送ってしまうとポータル側の権限運用が壊れる）。
 *
 * ■ なぜ必要か
 *   異動を人事管理で発令しても、ポータルの所属が古いままだと各業務アプリの
 *   部署・権限が追従しない。ここを繋ぐことで
 *     人事管理で発令 → ポータルの所属が変わる → ポータルが各アプリへ再連携
 *   という流れが成立する。
 *
 * ■ ポータル側に必要な受け口
 *   POST {PORTAL_BASE_URL}/api/hr-sync
 *   仕様と参照実装は docs/portal-hr-sync.md にまとめてある（pf-portal 側で実装する）。
 */

/** ポータルへ送る1人分。ポータルの pf_portal_users の列に対応する。 */
export interface PortalEmployeePayload {
  loginId: string;
  name: string;
  /** 所属部署コード（ポータルの pf_portal_departments.code） */
  departmentCode: string | null;
  /** 所属職場コード（ポータルの pf_portal_workplaces.code） */
  workplaceCode: string | null;
  positionName: string | null;
  dutyName: string | null;
  birthDate: string | null;
  hireDate: string | null;
  employmentType: string | null;
  /** 在籍状態。ポータル側はこれを見て退職者のアプリ利用を止める */
  status: EmploymentStatus;
  retireDate: string | null;
  email: string | null;
}

export interface PortalPushResult {
  sent: number;
  updated: number;
  created: number;
  /** ポータルに未登録などで何もしなかった件数 */
  skipped: number;
  /** 所属が変わったため各アプリへ再連携された件数 */
  reprovisioned: number;
  errors: { loginId: string; message: string }[];
}

function portalBaseUrl(): string {
  return (process.env.PORTAL_BASE_URL || "https://portal.paloma-pf.com").replace(/\/+$/, "");
}

/**
 * 連携対象を組み立てる。
 *
 * 所属は「人事管理の組織 → ポータルのコード」に読み替える。人事管理側で作った
 * 独自の階層（本部・部・課・係）はポータルに存在しないので、**ポータル由来の
 * コードを持つ最も近い祖先**を探して送る。
 * 例）「生産計画課(W001)」に居ればそのまま W001、ポータルに無い「第2係」に
 *     居れば親を辿って W001 を送る。
 */
export async function buildPortalPayload(): Promise<PortalEmployeePayload[]> {
  await ensureSchema();
  const sql = getSql();

  const units = await sql`
    SELECT id, parent_id, portal_dept_code, portal_workplace_code FROM jinji_org_units`;
  const byId = new Map<string, any>(units.map((u) => [u.id as string, u]));

  /**
   * 所属からポータルのコードを解決する。
   * 自分 → 親 → … と根まで1度だけ辿り、最初に出会った職場コードと部署コードを採る。
   * 職場は部署より下にあるので、この順で拾えば両方そろう。
   * 循環しているデータでも止まるよう訪問済みを見ている。
   */
  const resolvePortalCodes = (
    orgUnitId: string | null,
  ): { departmentCode: string | null; workplaceCode: string | null } => {
    let deptCode: string | null = null;
    let wpCode: string | null = null;
    const seen = new Set<string>();
    let cursor = orgUnitId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const u = byId.get(cursor);
      if (!u) break;
      if (!wpCode && u.portal_workplace_code) wpCode = u.portal_workplace_code as string;
      if (!deptCode && u.portal_dept_code) deptCode = u.portal_dept_code as string;
      cursor = (u.parent_id as string | null) ?? null;
    }
    return { departmentCode: deptCode, workplaceCode: wpCode };
  };

  const rows = await sql`
    SELECT employee_no, name, org_unit_id, position_name, duty_name,
           birth_date, hire_date, employment_type, status, retire_date, email
    FROM jinji_employees
    ORDER BY employee_no ASC`;

  return rows.map((r) => {
    const { departmentCode, workplaceCode } = resolvePortalCodes((r.org_unit_id as string | null) ?? null);
    return {
      loginId: r.employee_no as string,
      name: r.name as string,
      departmentCode,
      workplaceCode,
      positionName: (r.position_name as string | null) ?? null,
      dutyName: (r.duty_name as string | null) ?? null,
      birthDate: toISODate(r.birth_date),
      hireDate: toISODate(r.hire_date),
      employmentType: (r.employment_type as string | null) ?? null,
      status: normalizeEmploymentStatus(r.status),
      retireDate: toISODate(r.retire_date),
      email: (r.email as string | null) ?? null,
    };
  });
}

/** 特定の社員だけを連携対象にする（異動発令の直後など）。 */
export async function buildPortalPayloadFor(employeeNos: string[]): Promise<PortalEmployeePayload[]> {
  if (employeeNos.length === 0) return [];
  const all = await buildPortalPayload();
  const want = new Set(employeeNos);
  return all.filter((p) => want.has(p.loginId));
}

const FETCH_TIMEOUT_MS = 20000;

/**
 * ポータルへ送る。
 *
 * ポータル未対応（404/503）やネットワーク失敗は例外にせず結果として返す。
 * 連携が繋がっていなくても人事管理の業務は止めない、という方針
 * （発令そのものは人事管理側で完結しているため）。
 */
export async function pushToPortal(payload: PortalEmployeePayload[]): Promise<PortalPushResult> {
  const empty: PortalPushResult = { sent: 0, updated: 0, created: 0, skipped: 0, reprovisioned: 0, errors: [] };
  if (payload.length === 0) return empty;

  const key = (process.env.PF_PROVISION_KEY || "").trim();
  if (!key) {
    return { ...empty, errors: [{ loginId: "-", message: "PF_PROVISION_KEY が設定されていません。" }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${portalBaseUrl()}/api/hr-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, employees: payload }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404) {
      return {
        ...empty,
        errors: [
          {
            loginId: "-",
            message:
              "ポータルに受け口（/api/hr-sync）がまだありません。docs/portal-hr-sync.md の実装をポータルへ入れてください。",
          },
        ],
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ...empty, errors: [{ loginId: "-", message: `ポータルが ${res.status} を返しました。${text.slice(0, 200)}` }] };
    }
    const data = (await res.json().catch(() => null)) as
      | { results?: { loginId: string; status: string; message?: string; reprovisioned?: boolean }[] }
      | null;
    const results = data?.results ?? [];

    const out: PortalPushResult = {
      sent: payload.length,
      updated: 0,
      created: 0,
      skipped: 0,
      reprovisioned: 0,
      errors: [],
    };
    for (const r of results) {
      if (r.status === "created") out.created++;
      else if (r.status === "updated") out.updated++;
      else if (r.status === "skipped") out.skipped++;
      else out.errors.push({ loginId: r.loginId, message: r.message ?? "不明なエラー" });
      if (r.reprovisioned) out.reprovisioned++;
    }
    return out;
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "ポータルへの接続がタイムアウトしました。" : (e as Error).message;
    return { ...empty, errors: [{ loginId: "-", message: msg }] };
  } finally {
    clearTimeout(timer);
  }
}

/** 結果を1行の日本語にまとめる（画面表示・監査ログ用）。 */
export function describePushResult(r: PortalPushResult): string {
  if (r.sent === 0) return "連携対象がありませんでした。";
  const parts = [`送信 ${r.sent} 件`];
  if (r.created) parts.push(`新規 ${r.created} 件`);
  if (r.updated) parts.push(`更新 ${r.updated} 件`);
  if (r.reprovisioned) parts.push(`所属変更により各アプリへ再連携 ${r.reprovisioned} 件`);
  if (r.skipped) parts.push(`対象外 ${r.skipped} 件`);
  if (r.errors.length) parts.push(`失敗 ${r.errors.length} 件`);
  return parts.join(" / ");
}

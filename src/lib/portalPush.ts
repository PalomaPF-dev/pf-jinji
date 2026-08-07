import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { resolveManagers } from "./portalManagers";
import { mergesIntoParent } from "./orgChart";
import { toISODate } from "./format";
import { normalizeEmploymentStatus, type EmploymentStatus } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PF人事管理 → ポータルへのユーザー同期（push）。
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

/**
 * ポータルへ送る1人分。
 *
 * 送るのは**アカウントの生き死にと、承認フローに要るもの、そして所属**。
 * 生年月日・入社日・役職・職務は送らない（人事情報はポータルに置かない方針）。
 *
 * 所属（部署・職場）のコードは送るが、**部署・職場そのものは作らない**。
 * ポータルに同じコードの部署・職場があるときだけ引き当てる。
 * 「誰がどこに所属するか」は人事の情報で、「その部署でどのアプリを使えるか」は
 * ポータルの情報、という分け方にしている。
 */
export interface PortalEmployeePayload {
  loginId: string;
  name: string;
  /** 在籍状態。ポータル側はこれを見て退職者のアプリ利用を止める */
  status: EmploymentStatus;
  retireDate: string | null;
  /** 管理者（承認者）の社員番号。組織と職務から決める（portalManagers.ts） */
  managerLoginId: string | null;
  /** 所属する部・工場のコード（4桁）。ポータルに無ければ引き当てない */
  departmentCode: string | null;
  /** 所属する職場のコード（8桁）。ポータルに無ければ引き当てない */
  workplaceCode: string | null;
}

export interface PortalPushResult {
  sent: number;
  updated: number;
  created: number;
  /** ポータルに未登録などで何もしなかった件数 */
  skipped: number;
  /** ポータル側で各アプリへ再連携された件数 */
  reprovisioned: number;
  /** 承認者を設定した件数 */
  approverSet: number;
  /** 所属（部署・職場）が入った件数 */
  affiliationSet: number;
  /** ポータルに無かった部署コード（部署CSVの取込漏れ） */
  unknownDepartmentCodes: string[];
  /** ポータルに無かった職場コード（職場CSVの取込漏れ） */
  unknownWorkplaceCodes: string[];
  errors: { loginId: string; message: string }[];
}

function portalBaseUrl(): string {
  return (process.env.PORTAL_BASE_URL || "https://portal.paloma-pf.com").replace(/\/+$/, "");
}

/**
 * 組織ごとに「その人が属する部・工場のコード」と「職場のコード」を引けるようにする。
 *
 * 部・工場＝本部の直下（第2階層）。職場＝それより下（第3・第4階層）。
 * 「大口工場長」のように工場の枠へ統合される組織は、工場そのものとして扱い、
 * 職場コードは付けない（ポータル側では部付け＝職場なしになる）。
 */
async function buildOrgCodeMap(): Promise<
  Map<string, { departmentCode: string | null; workplaceCode: string | null }>
> {
  const sql = getSql();
  const units: any[] = await sql`
    SELECT id, parent_id, name, dept_code, workplace_code FROM jinji_org_units`;
  const byId = new Map(units.map((u) => [u.id as string, u]));

  const out = new Map<string, { departmentCode: string | null; workplaceCode: string | null }>();
  for (const u of units) {
    // 本部の直下（＝部・工場）まで遡る。途中の枠が職場になる。
    const chain: any[] = [];
    let cur: any = u;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id as string)) {
      seen.add(cur.id as string);
      chain.push(cur);
      const parent = cur.parent_id ? byId.get(cur.parent_id as string) : null;
      if (!parent) break; // cur が本部
      if (!parent.parent_id) break; // 親が本部＝cur が部・工場
      cur = parent;
    }
    const frame = chain[chain.length - 1]; // 部・工場（本部そのものの場合もある）
    const isFrame = frame && frame.id === u.id;
    const departmentCode = (frame?.dept_code as string | null) ?? null;
    // 工場の枠へ統合される組織（「大口工場長」など）は職場にしない
    const merged = !isFrame && frame && mergesIntoParent(frame.name as string, u.name as string);
    out.set(u.id as string, {
      departmentCode,
      workplaceCode: isFrame || merged ? null : ((u.workplace_code as string | null) ?? null),
    });
  }
  return out;
}

/**
 * 連携対象（ポータルのユーザー）を組み立てる。
 *
 * 「誰が居て、生きているか、その人の管理者は誰か、どこに所属するか」。
 * 所属はコードだけを送り、ポータルに同じコードの部署・職場があるときだけ
 * 引き当てられる（部署・職場そのものは作らない）。
 */
export async function buildPortalUsers(): Promise<PortalEmployeePayload[]> {
  await ensureSchema();
  const sql = getSql();
  const [rows, managers, orgCodes] = await Promise.all([
    sql`
      SELECT employee_no, name, status, retire_date, org_unit_id
      FROM jinji_employees
      ORDER BY employee_no ASC`,
    resolveManagers(),
    buildOrgCodeMap(),
  ]);
  return (rows as any[]).map((r) => {
    const org = r.org_unit_id ? orgCodes.get(r.org_unit_id as string) : null;
    return {
      loginId: r.employee_no as string,
      name: r.name as string,
      status: normalizeEmploymentStatus(r.status),
      retireDate: toISODate(r.retire_date),
      managerLoginId: managers.get(r.employee_no as string) ?? null,
      departmentCode: org?.departmentCode ?? null,
      workplaceCode: org?.workplaceCode ?? null,
    };
  });
}

/** 旧名。呼び出し側を一度に直せないので残してある。 */
export const buildPortalPayload = buildPortalUsers;

/** 特定の社員だけを連携対象にする（異動発令の直後など）。 */
export async function buildPortalPayloadFor(employeeNos: string[]): Promise<PortalEmployeePayload[]> {
  if (employeeNos.length === 0) return [];
  const all = await buildPortalPayload();
  const want = new Set(employeeNos);
  return all.filter((p) => want.has(p.loginId));
}

/**
 * 1回の送信の上限。ポータル側は一括SQLで処理するが、リクエストが大きすぎると
 * サーバーレスの実行時間・本文サイズの上限に当たるため分けて送る。
 */
const EMPLOYEE_CHUNK = 400;
const FETCH_TIMEOUT_MS = 60000;

/**
 * ポータルへ送る。
 *
 * ポータル未対応（404/503）やネットワーク失敗は例外にせず結果として返す。
 * 連携が繋がっていなくても人事管理の業務は止めない、という方針
 * （発令そのものは人事管理側で完結しているため）。
 */
export interface PortalPushOptions {
  /** ポータルに未登録の社員のアカウントを作る（パスワード未設定の招待状態） */
  createMissing?: boolean;
}

/**
 * ポータルへ送る。人数が多いときは分けて送り、結果を足し合わせる。
 *
 * 1回で全員を送ると、ポータル側の実行時間・本文サイズの上限に当たる。
 *
 * 分けて送ると、**先の回では管理者本人がまだポータルに居ない**ことがあり、
 * その人の承認者が決まらないまま終わる。全員を送り終えてからもう一巡すると
 * 全員が揃った状態で引けるので、2巡目を自動で回す（2巡目は所属も氏名も
 * 同じ値になるため、承認者だけが埋まる）。
 */
export async function pushToPortal(
  payload: PortalEmployeePayload[],
  options: PortalPushOptions = {},
): Promise<PortalPushResult> {
  const chunks: PortalEmployeePayload[][] = [];
  for (let i = 0; i < payload.length; i += EMPLOYEE_CHUNK) {
    chunks.push(payload.slice(i, i + EMPLOYEE_CHUNK));
  }
  if (chunks.length === 0) chunks.push([]);

  let total: PortalPushResult | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const r = await pushOnce(chunks[i], options);
    if (!total) {
      total = r;
    } else {
      total = {
        sent: total.sent + r.sent,
        updated: total.updated + r.updated,
        created: total.created + r.created,
        skipped: total.skipped + r.skipped,
        reprovisioned: total.reprovisioned + r.reprovisioned,
        approverSet: total.approverSet + r.approverSet,
        affiliationSet: total.affiliationSet + r.affiliationSet,
        unknownDepartmentCodes: [
          ...new Set([...total.unknownDepartmentCodes, ...r.unknownDepartmentCodes]),
        ],
        unknownWorkplaceCodes: [
          ...new Set([...total.unknownWorkplaceCodes, ...r.unknownWorkplaceCodes]),
        ],
        errors: [...total.errors, ...r.errors],
      };
    }
    // 接続断・鍵の未設定など、続けても同じ結果になる失敗は打ち切る
    if (r.sent === 0 && r.errors.length > 0 && r.created + r.updated === 0) break;
  }

  // 2巡目。管理者が後の回で作られたために決まらなかった人を埋める。
  // 数えるのは承認者だけ（人数や新規件数を二重に足さない）。
  if (chunks.length > 1 && total && total.errors.length === 0) {
    for (const chunk of chunks) {
      const r = await pushOnce(chunk, options);
      total.approverSet += r.approverSet;
      if (r.errors.length > 0) break;
    }
  }
  return total!;
}

async function pushOnce(
  payload: PortalEmployeePayload[],
  options: PortalPushOptions = {},
): Promise<PortalPushResult> {
  const empty: PortalPushResult = {
    sent: 0,
    updated: 0,
    created: 0,
    skipped: 0,
    reprovisioned: 0,
    approverSet: 0,
    affiliationSet: 0,
    unknownDepartmentCodes: [],
    unknownWorkplaceCodes: [],
    errors: [],
  };
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
      body: JSON.stringify({
        key,
        employees: payload,
        ...(options.createMissing ? { createMissing: true } : {}),
      }),
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
    const data = (await res.json().catch(() => null)) as {
      results?: {
        loginId: string;
        status: string;
        message?: string;
        reprovisioned?: boolean;
        approverSet?: boolean;
      }[];
      affiliationSet?: number;
      unknownDepartmentCodes?: string[];
      unknownWorkplaceCodes?: string[];
    } | null;
    const results = data?.results ?? [];

    const out: PortalPushResult = {
      sent: payload.length,
      updated: 0,
      created: 0,
      skipped: 0,
      reprovisioned: 0,
      approverSet: 0,
      affiliationSet: Number(data?.affiliationSet ?? 0),
      unknownDepartmentCodes: data?.unknownDepartmentCodes ?? [],
      unknownWorkplaceCodes: data?.unknownWorkplaceCodes ?? [],
      errors: [],
    };
    for (const r of results) {
      if (r.status === "created") out.created++;
      else if (r.status === "updated") out.updated++;
      else if (r.status === "skipped") out.skipped++;
      else out.errors.push({ loginId: r.loginId, message: r.message ?? "不明なエラー" });
      if (r.reprovisioned) out.reprovisioned++;
      if (r.approverSet) out.approverSet++;
    }
    return out;
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "ポータルへの接続がタイムアウトしました。" : (e as Error).message;
    return { ...empty, errors: [{ loginId: "-", message: msg }] };
  } finally {
    clearTimeout(timer);
  }
}

/** ポータルにしか居ない人（社員台帳に無いユーザー）。 */
export interface PortalStrayUser {
  loginId: string;
  name: string;
  role: string | null;
  departmentName: string | null;
}

export interface PortalPruneResult {
  /** 消える（消した）人数 */
  users: number;
  /** 実際に消した人数。下見のときは 0 */
  deleted: number;
  /** 下見だったか */
  dryRun: boolean;
  /** 一覧（ポータル側が上限200件で返す） */
  list: PortalStrayUser[];
  errors: { loginId: string; message: string }[];
}

/**
 * ポータルにしか居ない人を消す（社員台帳を正としてポータルを揃える）。
 *
 * 社員は分けて送るので、削除は**全員ぶんの社員番号を持った1回**で行う。
 * confirm を付けなければ下見だけで、ポータルは何も消さない。
 *
 * ポータル管理者（can_manage）は消さない。人事の台帳に載らない管理用の
 * アカウントがそこに含まれるため、消すと管理画面が操作できなくなる。
 */
export async function prunePortalUsers(
  payload: PortalEmployeePayload[],
  options: { confirm?: boolean } = {},
): Promise<PortalPruneResult> {
  const empty: PortalPruneResult = { users: 0, deleted: 0, dryRun: true, list: [], errors: [] };
  const key = (process.env.PF_PROVISION_KEY || "").trim();
  if (!key) {
    return { ...empty, errors: [{ loginId: "-", message: "PF_PROVISION_KEY が設定されていません。" }] };
  }
  if (payload.length === 0) {
    return { ...empty, errors: [{ loginId: "-", message: "社員台帳が空のため、何もしませんでした。" }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${portalBaseUrl()}/api/hr-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        prune: {
          keepLoginIds: payload.map((p) => p.loginId),
          ...(options.confirm ? { confirm: true } : {}),
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ...empty,
        errors: [{ loginId: "-", message: `ポータルが ${res.status} を返しました。${text.slice(0, 200)}` }],
      };
    }
    const data = (await res.json().catch(() => null)) as {
      prune?: {
        ok?: boolean;
        message?: string;
        users?: number;
        deleted?: number;
        dryRun?: boolean;
        list?: PortalStrayUser[];
      };
    } | null;
    const p = data?.prune;
    if (!p) {
      return {
        ...empty,
        errors: [
          {
            loginId: "-",
            message: "ポータルがこの操作に未対応です（受け口を新しいものへ更新してください）。",
          },
        ],
      };
    }
    if (p.ok === false) {
      return { ...empty, errors: [{ loginId: "-", message: p.message ?? "ポータル側で実行できませんでした。" }] };
    }
    return {
      users: Number(p.users ?? 0),
      deleted: Number(p.deleted ?? 0),
      dryRun: p.dryRun !== false,
      list: p.list ?? [],
      errors: [],
    };
  } catch (e) {
    const msg =
      (e as Error).name === "AbortError" ? "ポータルへの接続がタイムアウトしました。" : (e as Error).message;
    return { ...empty, errors: [{ loginId: "-", message: msg }] };
  } finally {
    clearTimeout(timer);
  }
}

/** 結果を1行の日本語にまとめる（画面表示・監査ログ用）。 */
export function describePushResult(r: PortalPushResult): string {
  if (r.sent === 0) return "連携対象がありませんでした。";
  const parts: string[] = [`ユーザー ${r.sent} 件`];
  if (r.created) parts.push(`アカウント新規 ${r.created} 件`);
  if (r.updated) parts.push(`更新 ${r.updated} 件`);
  if (r.affiliationSet) parts.push(`所属 ${r.affiliationSet} 件`);
  if (r.approverSet) parts.push(`承認者 ${r.approverSet} 件`);
  if (r.skipped) parts.push(`対象外 ${r.skipped} 件`);
  if (r.errors.length) parts.push(`失敗 ${r.errors.length} 件`);
  return parts.join(" / ");
}

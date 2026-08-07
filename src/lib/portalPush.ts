import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { resolveManagers } from "./portalManagers";
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
 * 送るのは**アカウントの生き死にと、承認フローに要るものだけ**。
 * 生年月日・入社日・役職・職務・部署・職場は送らない（人事情報はポータルに
 * 置かない方針のため）。部署・工場ごとのアプリ割当もポータル側の運用に任せる。
 */
export interface PortalEmployeePayload {
  loginId: string;
  name: string;
  /** 在籍状態。ポータル側はこれを見て退職者のアプリ利用を止める */
  status: EmploymentStatus;
  retireDate: string | null;
  /** 管理者（承認者）の社員番号。組織と職務から決める（portalManagers.ts） */
  managerLoginId: string | null;
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
  errors: { loginId: string; message: string }[];
}

function portalBaseUrl(): string {
  return (process.env.PORTAL_BASE_URL || "https://portal.paloma-pf.com").replace(/\/+$/, "");
}

/**
 * 連携対象（ポータルのユーザー）を組み立てる。
 *
 * 部署・工場はポータル側で持つので送らない。ここで作るのは
 * 「誰が居て、生きているか、その人の管理者は誰か」だけ。
 * 管理者は組織と職務から決める（portalManagers.ts）。
 */
export async function buildPortalUsers(): Promise<PortalEmployeePayload[]> {
  await ensureSchema();
  const sql = getSql();
  const [rows, managers] = await Promise.all([
    sql`
      SELECT employee_no, name, status, retire_date
      FROM jinji_employees
      ORDER BY employee_no ASC`,
    resolveManagers(),
  ]);
  return (rows as any[]).map((r) => ({
    loginId: r.employee_no as string,
    name: r.name as string,
    status: normalizeEmploymentStatus(r.status),
    retireDate: toISODate(r.retire_date),
    managerLoginId: managers.get(r.employee_no as string) ?? null,
  }));
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
 * 組織は最初の1回だけ一緒に送る（部署・職場が無いと社員の所属を解決できないため）。
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
        errors: [...total.errors, ...r.errors],
      };
    }
    // 接続断・鍵の未設定など、続けても同じ結果になる失敗は打ち切る
    if (r.sent === 0 && r.errors.length > 0 && r.created + r.updated === 0) break;
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
    } | null;
    const results = data?.results ?? [];

    const out: PortalPushResult = {
      sent: payload.length,
      updated: 0,
      created: 0,
      skipped: 0,
      reprovisioned: 0,
      approverSet: 0,
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

/** 結果を1行の日本語にまとめる（画面表示・監査ログ用）。 */
export function describePushResult(r: PortalPushResult): string {
  if (r.sent === 0) return "連携対象がありませんでした。";
  const parts: string[] = [`ユーザー ${r.sent} 件`];
  if (r.created) parts.push(`アカウント新規 ${r.created} 件`);
  if (r.updated) parts.push(`更新 ${r.updated} 件`);
  if (r.approverSet) parts.push(`承認者 ${r.approverSet} 件`);
  if (r.skipped) parts.push(`対象外 ${r.skipped} 件`);
  if (r.errors.length) parts.push(`失敗 ${r.errors.length} 件`);
  return parts.join(" / ");
}

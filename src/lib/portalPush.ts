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
  /** 管理者（承認者）の社員番号。人事マスタの承認者一覧から入る */
  managerLoginId: string | null;
}

/**
 * ポータルへ送る組織1件。人事管理の組織台帳がそのまま部署・職場になる。
 *
 * 部署 ＝ 本部直下（工場・部）、職場 ＝ その配下。
 * code は人事側のコード（部署コード・職場コード）をそのまま使う。
 * ポータル側は「同名の既存があればそれに紐づけ、無ければ新規作成」する。
 */
export interface PortalOrgPayload {
  kind: "dept" | "workplace";
  code: string;
  name: string;
  /** 職場のとき、その所属部署のコード */
  departmentCode: string | null;
  /** 工場か（ポータルの kind='factory' に対応。部署のみ） */
  isFactory: boolean;
  sort: number;
}

export interface PortalPushResult {
  sent: number;
  updated: number;
  created: number;
  /** ポータルに未登録などで何もしなかった件数 */
  skipped: number;
  /** 所属が変わったため各アプリへ再連携された件数 */
  reprovisioned: number;
  /** 承認者を設定した件数 */
  approverSet: number;
  /** 組織の連携結果 */
  orgs: { sent: number; created: number; linked: number; updated: number };
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
  const { employees } = await buildPortalSync();
  return employees;
}

/**
 * 組織と社員をまとめて組み立てる。
 *
 * 人事管理の組織台帳が正なので、**ポータルの部署・職場もここから作る**。
 *   部署 ＝ 本部直下（工場・部・統括室）
 *   職場 ＝ その配下すべて（安全推進工場長室・各ライン・配送センター…）
 * コードは人事側のもの（部署コード・職場コード。無ければ組織コード）を送り、
 * ポータルは同名の既存部署・職場があればそれに紐づけ、無ければ新規作成する。
 *
 * 社員の所属は、この規則で決まる部署・職場のコードで送る。
 */
export async function buildPortalSync(): Promise<{
  orgs: PortalOrgPayload[];
  employees: PortalEmployeePayload[];
}> {
  await ensureSchema();
  const sql = getSql();

  const units = await sql`
    SELECT id, parent_id, code, name, kind, sort, dept_code, workplace_code,
           portal_dept_code, portal_workplace_code
    FROM jinji_org_units
    ORDER BY sort ASC, name ASC`;
  const byId = new Map<string, any>(units.map((u) => [u.id as string, u]));

  /**
   * その組織**自身**のコード。
   * 職場コード（自分の8桁）→ 部署コード（工場・部のグループ）→ ポータル由来 → 組織コード。
   * 部署コードを先に見ないのは、8桁組織の dept_code が「自分が属するグループ」を
   * 指していて自分自身の識別子ではないため（同じコードが複数の組織に付く）。
   */
  const codeOf = (u: any): string => {
    const code =
      (u.workplace_code as string | null) ??
      (u.dept_code as string | null) ??
      (u.portal_workplace_code as string | null) ??
      (u.portal_dept_code as string | null) ??
      (u.code as string);
    // ポータルのコードは URL・画面に出るので英数字に限る。
    // 名称ルールで自動生成した組織（「AUTO-調達部」など）は日本語を含むため、
    // 組織IDから安定したコードを振る（同じ組織なら毎回同じコードになる）。
    return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : `HR-${(u.id as string).slice(0, 8)}`;
  };

  const normName = (s: string) =>
    s.normalize("NFKC").replace(/[\s　]+/g, "").replace(/[ッｯ]/g, "");

  // 本部（親なし）→ その直下が部署 → さらに下は職場
  const roots = units.filter((u: any) => !u.parent_id);
  const rootIds = new Set(roots.map((r: any) => r.id as string));
  const deptCodeOfOrg = new Map<string, string>(); // 組織id → 属する部署のコード
  const deptIdSet = new Set<string>(); // 部署そのものの組織id
  const orgs: PortalOrgPayload[] = [];
  let sortSeq = 0;

  for (const root of roots) {
    // 同名の部署枠は1つに畳む（人事マスタ由来の「生産管理部」グループと、
    // 8桁の「生産管理部」が並ぶことがある）。子を持つ方を残す。
    const deptGroups = new Map<string, any[]>();
    for (const d of units.filter((u: any) => u.parent_id === root.id)) {
      const key = normName(d.name as string);
      deptGroups.set(key, [...(deptGroups.get(key) ?? []), d]);
    }

    for (const group of deptGroups.values()) {
      const childrenOf = (id: string) => units.filter((u: any) => u.parent_id === id);
      const primary =
        group.find((d: any) => childrenOf(d.id as string).length > 0) ?? group[0];
      const deptCode = codeOf(primary);
      orgs.push({
        kind: "dept",
        code: deptCode,
        name: primary.name as string,
        departmentCode: null,
        isFactory: (primary.kind as string) === "factory" || /工場$/.test(primary.name as string),
        sort: sortSeq++,
      });

      // 畳んだ枠も含めて、この部署の配下すべてを職場として送る
      // （ポータルは 部署→職場 の2階層なので、深さは平らにする）
      const seen = new Set<string>();
      const stack: any[] = [];
      for (const d of group) {
        deptIdSet.add(d.id as string);
        deptCodeOfOrg.set(d.id as string, deptCode);
        stack.push(...childrenOf(d.id as string));
      }
      while (stack.length > 0) {
        const w = stack.shift()!;
        const id = w.id as string;
        if (seen.has(id)) continue;
        seen.add(id);
        deptCodeOfOrg.set(id, deptCode);
        const wpCode = codeOf(w);
        // 「大口工場長」のように部署そのものと同じコードの組織は職場にしない。
        // 実体は部署の長なので、所属者は部署直属として送る（組織図の見せ方と同じ）。
        if (wpCode === deptCode) {
          deptIdSet.add(id);
        } else {
          orgs.push({
            kind: "workplace",
            code: wpCode,
            name: w.name as string,
            departmentCode: deptCode,
            isFactory: false,
            sort: sortSeq++,
          });
        }
        stack.push(...childrenOf(id));
      }
    }
  }

  /** 所属から「部署コード・職場コード」を決める。本部直下・未配置は職場なし。 */
  const resolveCodes = (
    orgUnitId: string | null,
  ): { departmentCode: string | null; workplaceCode: string | null } => {
    if (!orgUnitId) return { departmentCode: null, workplaceCode: null };
    const u = byId.get(orgUnitId);
    if (!u) return { departmentCode: null, workplaceCode: null };
    // 本部そのものに所属している人は部署なし（ポータル側で据え置き）
    if (rootIds.has(orgUnitId)) return { departmentCode: null, workplaceCode: null };
    const departmentCode = deptCodeOfOrg.get(orgUnitId) ?? null;
    if (!departmentCode) return { departmentCode: null, workplaceCode: null };
    // 部署そのものに所属＝職場なし
    if (deptIdSet.has(orgUnitId)) return { departmentCode, workplaceCode: null };
    return { departmentCode, workplaceCode: codeOf(u) };
  };

  const rows = await sql`
    SELECT employee_no, name, org_unit_id, position_name, duty_name,
           birth_date, hire_date, employment_type, status, retire_date, email,
           manager_employee_no
    FROM jinji_employees
    ORDER BY employee_no ASC`;

  const employees = rows.map((r) => {
    const { departmentCode, workplaceCode } = resolveCodes((r.org_unit_id as string | null) ?? null);
    const manager = (r.manager_employee_no as string | null) ?? null;
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
      // 自分自身が承認者になっている行（管理者本人）は承認者なしとして送る
      managerLoginId: manager && manager !== (r.employee_no as string) ? manager : null,
    };
  });

  return { orgs, employees };
}

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
  /** 組織（部署・職場）も同期する */
  orgs?: PortalOrgPayload[];
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
    // 組織は先頭の1回だけ。2回目以降に送っても結果は同じだが、無駄な往復になる
    const r = await pushOnce(chunks[i], i === 0 ? options : { ...options, orgs: [] });
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
        orgs: total.orgs,
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
    orgs: { sent: 0, created: 0, linked: 0, updated: 0 },
    errors: [],
  };
  const orgs = options.orgs ?? [];
  if (payload.length === 0 && orgs.length === 0) return empty;

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
        ...(orgs.length > 0 ? { organizations: orgs } : {}),
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
      organizations?: { created?: number; linked?: number; updated?: number; errors?: string[] };
    } | null;
    const results = data?.results ?? [];

    const out: PortalPushResult = {
      sent: payload.length,
      updated: 0,
      created: 0,
      skipped: 0,
      reprovisioned: 0,
      approverSet: 0,
      orgs: {
        sent: orgs.length,
        created: data?.organizations?.created ?? 0,
        linked: data?.organizations?.linked ?? 0,
        updated: data?.organizations?.updated ?? 0,
      },
      errors: (data?.organizations?.errors ?? []).map((m) => ({ loginId: "組織", message: m })),
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
  if (r.sent === 0 && r.orgs.sent === 0) return "連携対象がありませんでした。";
  const parts: string[] = [];
  if (r.orgs.sent) {
    const o = [`組織 ${r.orgs.sent} 件`];
    if (r.orgs.created) o.push(`新規 ${r.orgs.created}`);
    if (r.orgs.linked) o.push(`既存へ紐づけ ${r.orgs.linked}`);
    if (r.orgs.updated) o.push(`更新 ${r.orgs.updated}`);
    parts.push(o.join(" "));
  }
  if (r.sent) parts.push(`社員 ${r.sent} 件`);
  if (r.created) parts.push(`アカウント新規 ${r.created} 件`);
  if (r.updated) parts.push(`更新 ${r.updated} 件`);
  if (r.approverSet) parts.push(`承認者 ${r.approverSet} 件`);
  if (r.reprovisioned) parts.push(`所属変更により各アプリへ再連携 ${r.reprovisioned} 件`);
  if (r.skipped) parts.push(`対象外 ${r.skipped} 件`);
  if (r.errors.length) parts.push(`失敗 ${r.errors.length} 件`);
  return parts.join(" / ");
}

import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import type { AuditAction, AuditLog } from "./types";

/**
 * 監査ログ。人事情報は本部で最も機微なデータのため、
 * 給与・考課については**閲覧も**記録する。
 *
 * 記録の失敗で業務を止めない（throw しない）。ただし警告は必ず残す。
 */
export async function recordAudit(params: {
  actorLoginId: string;
  actorName?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO jinji_audit_logs
        (actor_login_id, actor_name, action, target_type, target_id, target_label, detail)
      VALUES (${params.actorLoginId}, ${params.actorName ?? null}, ${params.action},
              ${params.targetType ?? null}, ${params.targetId ?? null}, ${params.targetLabel ?? null},
              ${params.detail ? JSON.stringify(params.detail) : null})`;
  } catch (e) {
    console.warn("[audit] failed to record:", params.action, (e as Error).message);
  }
}

/** 監査ログを新しい順に取得（設定画面用）。 */
export async function listAuditLogs(limit = 200, action?: AuditAction | null): Promise<AuditLog[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = action
    ? await sql`
        SELECT * FROM jinji_audit_logs WHERE action = ${action}
        ORDER BY created_at DESC LIMIT ${limit}`
    : await sql`
        SELECT * FROM jinji_audit_logs
        ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    actorLoginId: r.actor_login_id as string,
    actorName: (r.actor_name as string | null) ?? null,
    action: r.action as AuditAction,
    targetType: (r.target_type as string | null) ?? null,
    targetId: (r.target_id as string | null) ?? null,
    targetLabel: (r.target_label as string | null) ?? null,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : null,
  }));
}

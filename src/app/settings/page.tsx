import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireOwnerSession } from "@/lib/session";
import { listAdmins } from "@/lib/admins";
import { listQualificationMasters } from "@/lib/qualifications";
import { listEvaluationItems } from "@/lib/evaluations";
import { listAuditLogs } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import AdminUpsertForm, { IssueLinkForm, RemoveAdminForm } from "@/components/AdminForms";
import QualificationMasterForm, {
  DeleteQualificationMasterForm,
} from "@/components/QualificationMasterForms";
import PortalPushPanel from "@/components/PortalPushPanel";
import { AUDIT_ACTION_LABEL, QUALIFICATION_CATEGORY_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 設定。利用許可名簿・資格マスター・考課項目・監査ログ。責任者（owner）のみ。 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const s = await requireOwnerSession();
  const { edit } = await searchParams;

  const [admins, masters, items, logs] = await Promise.all([
    listAdmins(),
    listQualificationMasters(false),
    listEvaluationItems(false),
    listAuditLogs(100),
  ]);
  const editing = edit ? admins.find((a) => a.loginId === edit) : undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title="設定" description="利用許可名簿・各種マスター・監査ログ" />

      <div className="space-y-8">
        {/* ===== 利用許可名簿 ===== */}
        <section>
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-[#f0e2c8] bg-[#fdfaf3] p-4 text-xs text-[#a06a12]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              アクセス可否は<strong>ポータルの権限</strong>で決まります。
              ポータル管理者は全機能（給与・考課・設定を含む）、ポータルの管理者権限を持つ方は
              その他の機能（社員台帳・組織図・申請書・資格）を扱えます。
              この名簿は、ポータルの権限が届かない状態でもアプリを管理できる
              <strong>責任者の控え</strong>としてだけ使います。
            </p>
          </div>

          <div className="mb-4 overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                  <th className="px-4 py-3 font-medium">社員番号</th>
                  <th className="px-4 py-3 font-medium">お名前</th>
                  <th className="px-4 py-3 font-medium">責任者</th>
                  <th className="px-4 py-3 font-medium">メモ</th>
                  <th className="px-4 py-3 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.loginId} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                    <td className="px-4 py-3 font-mono text-xs text-[#707070]">{a.loginId}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/settings?edit=${encodeURIComponent(a.loginId)}`}
                        className="font-medium text-[#2563eb] hover:underline"
                      >
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{a.isOwner ? "○" : "—"}</td>
                    <td className="px-4 py-3 text-xs text-[#909090]">{a.note ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <IssueLinkForm loginId={a.loginId} name={a.name} />
                        {a.loginId !== s.grant.loginId && (
                          <RemoveAdminForm loginId={a.loginId} name={a.name} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <AdminUpsertForm key={editing?.loginId ?? "new"} editing={editing} />
        </section>

        {/* ===== ポータル連携 ===== */}
        <section>
          <h2 className="mb-3 text-base font-bold text-[#333333]">ポータル連携</h2>
          <PortalPushPanel />
        </section>

        {/* ===== 資格マスター ===== */}
        <section>
          <h2 className="mb-3 text-base font-bold text-[#333333]">資格マスター</h2>
          {masters.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                    <th className="px-4 py-3 font-medium">コード</th>
                    <th className="px-4 py-3 font-medium">資格名</th>
                    <th className="px-4 py-3 font-medium">区分</th>
                    <th className="px-4 py-3 font-medium">更新</th>
                    <th className="px-4 py-3 font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {masters.map((m) => (
                    <tr key={m.id} className="border-b border-[#f0f0f0] last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-[#707070]">{m.code}</td>
                      <td className="px-4 py-3 text-[#333333]">{m.name}</td>
                      <td className="px-4 py-3 text-[#555555]">{QUALIFICATION_CATEGORY_LABEL[m.category]}</td>
                      <td className="px-4 py-3 text-[#707070]">
                        {m.renewalRequired ? `${m.renewalMonths}か月ごと` : "不要"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeleteQualificationMasterForm id={m.id} label={m.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <QualificationMasterForm />
        </section>

        {/* ===== 考課項目 ===== */}
        <section>
          <h2 className="mb-3 text-base font-bold text-[#333333]">人事考課の項目</h2>
          <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                  <th className="px-4 py-3 font-medium">コード</th>
                  <th className="px-4 py-3 font-medium">分類</th>
                  <th className="px-4 py-3 font-medium">項目</th>
                  <th className="px-4 py-3 text-right font-medium">配点</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-[#f0f0f0] last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-[#707070]">{it.code}</td>
                    <td className="px-4 py-3 text-[#555555]">{it.category}</td>
                    <td className="px-4 py-3 text-[#333333]">{it.name}</td>
                    <td className="px-4 py-3 text-right text-[#707070]">{it.maxScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#909090]">
            初期値として標準的な10項目を用意しています。過去の考課は項目コードで保存しているため、
            項目を入れ替えても既に確定した考課の点数は壊れません。
          </p>
        </section>

        {/* ===== 監査ログ ===== */}
        <section>
          <h2 className="mb-3 text-base font-bold text-[#333333]">監査ログ（直近100件）</h2>
          <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                  <th className="px-4 py-3 font-medium">日時</th>
                  <th className="px-4 py-3 font-medium">実行者</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                  <th className="px-4 py-3 font-medium">対象</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-[#f0f0f0] last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-[#707070]">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-[#555555]">
                      {l.actorName ?? l.actorLoginId}
                      <div className="text-xs text-[#909090]">{l.actorLoginId}</div>
                    </td>
                    <td className="px-4 py-3 text-[#333333]">
                      {AUDIT_ACTION_LABEL[l.action] ?? l.action}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#707070]">{l.targetLabel ?? "—"}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-[#909090]">
                      まだ記録がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#909090]">
            給与・人事考課は、更新だけでなく<strong>閲覧も</strong>記録しています。
          </p>
        </section>
      </div>
    </div>
  );
}

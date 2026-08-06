"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  previewPortalPushAction,
  pushPortalAction,
  type PortalPushState,
} from "@/app/settings/portalActions";
import { EMPLOYMENT_STATUS_LABEL } from "@/lib/types";

function Button({
  children,
  variant = "secondary",
  confirm,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const style =
    variant === "primary"
      ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
      : "border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]";
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${style}`}
    >
      {pending ? "処理中…" : children}
    </button>
  );
}

/**
 * ポータルへの人事情報連携。
 *
 * 人事管理が「人」と「組織」のマスター。ここから組織・人事情報・承認者を送る。
 * パスワードとアプリの利用権限（role / can_manage / 部署の apps）はポータルが
 * 持つ情報なので送らない。
 */
export default function PortalPushPanel() {
  const [preview, previewAction] = useActionState(previewPortalPushAction, {} as PortalPushState);
  const [push, pushAction] = useActionState(pushPortalAction, {} as PortalPushState);
  const state = push.message || push.error || push.failures ? push : preview;

  return (
    <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">ポータルへの人事情報連携</h2>
      <p className="mb-4 text-xs text-[#707070]">
        この人事管理が持つ<strong>組織（部署・職場）・所属・役職・職務・入社日・雇用体系・在籍状態</strong>
        と、社員ごとの<strong>管理者（承認者）</strong>・<strong>職場の長</strong>をポータルへ送り、
        ポータル側を最新にします。ポータルはこれを受けて各業務アプリへ再連携するため、
        異動が各アプリの部署にも反映されます。
        <br />
        パスワードとアプリの利用権限（ポータルの権限・部署へのアプリ割当）は
        <strong>ポータルが持つ情報なので変更しません</strong>（上書きすると権限運用が壊れるため）。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <form action={previewAction}>
          <Button>連携内容を確認</Button>
        </form>
        <form action={pushAction}>
          <Button
            variant="primary"
            confirm="人事情報をポータルへ送ります。ポータル側の社員情報が人事管理の内容で更新されます。よろしいですか？"
          >
            <Upload className="h-4 w-4" />
            ポータルへ連携
          </Button>
        </form>
      </div>

      {state.error && (
        <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{state.error}</p>
      )}
      {state.message && (
        <p className="mt-3 rounded-lg bg-[#e8f3ec] px-3 py-2 text-sm text-[#1c7a4d]">{state.message}</p>
      )}

      {state.failures && state.failures.length > 0 && (
        <ul className="mt-3 space-y-1">
          {state.failures.map((f, i) => (
            <li key={i} className="rounded-lg bg-[#fdf6f6] px-3 py-2 text-xs text-[#b91c1c]">
              {f.loginId !== "-" && <span className="font-mono">{f.loginId}: </span>}
              {f.message}
            </li>
          ))}
        </ul>
      )}

      {preview.preview && preview.preview.length > 0 && (
        <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-[#e5e5e5]">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0">
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-3 py-2 font-medium">社員番号</th>
                <th className="px-3 py-2 font-medium">氏名</th>
                <th className="px-3 py-2 font-medium">部署コード</th>
                <th className="px-3 py-2 font-medium">職場コード</th>
                <th className="px-3 py-2 font-medium">役職</th>
                <th className="px-3 py-2 font-medium">在籍</th>
              </tr>
            </thead>
            <tbody>
              {preview.preview.map((p) => (
                <tr key={p.loginId} className="border-b border-[#f0f0f0] last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-[#707070]">{p.loginId}</td>
                  <td className="px-3 py-2 text-[#333333]">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[#555555]">
                    {p.departmentCode ?? <span className="text-[#c0392b]">未解決</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[#555555]">{p.workplaceCode ?? "—"}</td>
                  <td className="px-3 py-2 text-[#555555]">{p.positionName ?? "—"}</td>
                  <td className="px-3 py-2 text-[#555555]">{EMPLOYMENT_STATUS_LABEL[p.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.preview?.some((p) => !p.departmentCode) && (
        <p className="mt-2 text-xs text-[#a06a12]">
          「未解決」の社員は、所属がポータルの部署に紐づいていません。組織図でポータル由来の
          部署の配下に配置するか、ポータルの部署を同期してください。この社員の所属は送られません。
        </p>
      )}
    </section>
  );
}

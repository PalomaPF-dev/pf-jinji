"use client";

import { useActionState } from "react";
import { Trash2, Upload } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  portalPruneAction,
  previewPortalPruneAction,
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
 * ポータルへのユーザー同期。
 *
 * 送るのは「誰が居て、生きているか、その人の管理者は誰か」だけ。
 * 部署・工場とアプリの割当、パスワードと権限（role / can_manage / apps）は
 * ポータル側の運用なので触らない。人事情報（生年月日・入社日・役職・職務）も送らない。
 */
export default function PortalPushPanel() {
  const [preview, previewAction] = useActionState(previewPortalPushAction, {} as PortalPushState);
  const [push, pushAction] = useActionState(pushPortalAction, {} as PortalPushState);
  const [prunePreview, prunePreviewAction] = useActionState(
    previewPortalPruneAction,
    {} as PortalPushState,
  );
  const [prune, pruneAction] = useActionState(portalPruneAction, {} as PortalPushState);
  const state = push.message || push.error || push.failures ? push : preview;
  const pruneState = prune.message || prune.error ? prune : prunePreview;

  return (
    <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
      <h2 className="mb-1 text-sm font-bold text-[#333333]">ポータルへのユーザー同期</h2>
      <p className="mb-3 text-xs text-[#707070]">
        社員台帳の人を、ポータルの<strong>ユーザー</strong>として同期します。送るのは
        <strong>社員番号・氏名・在籍状態（退職日）</strong>と、
        <strong>その人の管理者（承認者）</strong>だけです。
        ポータルに居ない人は、パスワード未設定の招待状態でアカウントを作ります。
      </p>
      <p className="mb-3 text-xs text-[#707070]">
        <strong>送らないもの</strong>: 生年月日・入社日・雇用体系・役職・職務・部署・職場・メール。
        部署や工場ごとのアプリの割当、パスワード、ポータルの権限（管理者・ポータル管理）も
        ポータル側の運用なので触りません。
      </p>
      <div className="mb-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs text-[#707070]">
        <strong>管理者（承認者）の決め方</strong>: 組織を上へ辿って、自分より上位の管理者が
        最初に見つかった人です。管理者になる職務は
        <strong>部門長 ＞ 工場長A ＞ 工場長B ＞ 室長 ＞ グループ長 ＝ 安全推進工場長室</strong>の6つ。
        安全推進工場長室はグループ長と同じ高さなので、その人たちの管理者は工場長になります。
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action={previewAction}>
          <Button>連携内容を確認</Button>
        </form>
        <form action={pushAction}>
          <Button
            variant="primary"
            confirm="ポータルのユーザーを同期します。氏名・在籍状態・管理者が人事管理の内容で更新されます。よろしいですか？"
          >
            <Upload className="h-4 w-4" />
            ポータルへ同期
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
                <th className="px-3 py-2 font-medium">在籍</th>
                <th className="px-3 py-2 font-medium">管理者（承認者）</th>
              </tr>
            </thead>
            <tbody>
              {preview.preview.map((p) => (
                <tr key={p.loginId} className="border-b border-[#f0f0f0] last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-[#707070]">{p.loginId}</td>
                  <td className="px-3 py-2 text-[#333333]">{p.name}</td>
                  <td className="px-3 py-2 text-[#555555]">{EMPLOYMENT_STATUS_LABEL[p.status]}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[#555555]">
                    {p.managerLoginId ?? <span className="text-[#a06a12]">なし</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.preview?.some((p) => !p.managerLoginId) && (
        <p className="mt-2 text-xs text-[#a06a12]">
          管理者が「なし」の人は、組織を上へ辿っても自分より上位の管理者が見つからなかった人です
          （部門長など最上位の人はこれで正しい）。それ以外は組織図で職務を確かめてください。
        </p>
      )}

      {/* ポータルにしか居ない人の掃除。同期は「足す・直す」だけなので、
          台帳から消えた人はここで消さないとポータルに残り続ける。 */}
      <div className="mt-6 rounded-lg border border-[#f0d9d9] bg-[#fdf7f7] p-4">
        <h3 className="mb-1 text-sm font-bold text-[#333333]">ポータルにしか居ない人を消す</h3>
        <p className="mb-3 text-xs text-[#707070]">
          同期は「足す・直す」だけなので、<strong>社員台帳から消えた人はポータルに残り続けます</strong>。
          ここで社員台帳に無いユーザーをポータルの名簿から削除して、両方を揃えます。
          <strong>ポータル管理のユーザーは消しません</strong>
          （人事の台帳に載らない管理用のアカウントが含まれるため）。
          <strong>各アプリ側のアカウントも消えません</strong>。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form action={prunePreviewAction}>
            <Button>消える人を確認</Button>
          </form>
          <form action={pruneAction}>
            <Button
              variant="primary"
              confirm="社員台帳に無いユーザーをポータルの名簿から削除します。※各アプリ側のアカウントは削除されません。よろしいですか？"
            >
              <Trash2 className="h-4 w-4" />
              ポータルから削除
            </Button>
          </form>
        </div>

        {pruneState.error && (
          <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{pruneState.error}</p>
        )}
        {pruneState.message && (
          <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-[#555555]">{pruneState.message}</p>
        )}

        {pruneState.strays && pruneState.strays.length > 0 && (
          <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[#e5e5e5] bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                  <th className="px-3 py-2 font-medium">社員番号</th>
                  <th className="px-3 py-2 font-medium">氏名</th>
                  <th className="px-3 py-2 font-medium">権限</th>
                  <th className="px-3 py-2 font-medium">部署</th>
                </tr>
              </thead>
              <tbody>
                {pruneState.strays.map((u) => (
                  <tr key={u.loginId} className="border-b border-[#f0f0f0] last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-[#707070]">{u.loginId}</td>
                    <td className="px-3 py-2 text-[#333333]">{u.name}</td>
                    <td className="px-3 py-2 text-[#555555]">{u.role === "admin" ? "管理者" : "一般"}</td>
                    <td className="px-3 py-2 text-[#555555]">{u.departmentName ?? "未設定"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

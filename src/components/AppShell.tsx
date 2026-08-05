"use client";

import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  Network,
  FileText,
  FileClock,
  ClipboardCheck,
  Wallet,
  Award,
  Settings,
  Mail,
  LogOut,
} from "lucide-react";
import { AppShell as BaseAppShell, type NavGroup } from "@paloma-pf/ui";

/**
 * 人事アプリのシェル。共通の @paloma-pf/ui の AppShell に、
 * このアプリ固有のナビ・テーマを差し込む。
 *
 * 給与・考課のナビは権限を持つ人にだけ出す（サーバー側で判定した結果を props で受け取る）。
 * ※ナビを隠すのは導線の整理であって、アクセス制御ではない。実際のガードは
 *   各ページ・各 Server Action の requireXxxSession が毎回 DB を見て行う。
 */
export default function AppShell({
  children,
  canPayroll,
  canEvaluation,
  isOwner,
}: {
  children: React.ReactNode;
  canPayroll: boolean;
  canEvaluation: boolean;
  isOwner: boolean;
}) {
  const nav: NavGroup[] = [
    {
      items: [{ href: "/", label: "ダッシュボード", icon: LayoutDashboard }],
    },
    {
      title: "人事マスター",
      items: [
        { href: "/employees", label: "社員台帳", icon: Users },
        { href: "/org", label: "組織図", icon: Network },
        { href: "/qualifications", label: "資格", icon: Award },
      ],
    },
    {
      title: "手続き",
      items: [
        { href: "/transfers", label: "異動申請書", icon: FileText },
        { href: "/reemployments", label: "継続雇用申請書", icon: FileClock },
      ],
    },
    // 給与・考課は設定と並ぶ「管理」。ポータル管理者にだけ出す
    ...(canEvaluation || canPayroll || isOwner
      ? [
          {
            title: "管理",
            items: [
              ...(canEvaluation ? [{ href: "/evaluations", label: "人事考課", icon: ClipboardCheck }] : []),
              ...(canPayroll ? [{ href: "/salaries", label: "基本給与", icon: Wallet }] : []),
              ...(isOwner ? [{ href: "/settings", label: "設定", icon: Settings }] : []),
            ],
          },
        ]
      : []),
  ];

  return (
    <BaseAppShell
      nav={nav}
      brand={{ eyebrow: "株式会社パロマ", title: "PF人事管理", subtitle: "人事情報・組織図・異動申請" }}
      accent="#2563eb"
      // 認証系に加え、名簿未登録者の案内（/forbidden）と初期セットアップ（/setup）も
      // シェル無しで出す。どちらもナビを見せる意味が無い画面のため。
      bareRoutes={["/login", "/password-reset", "/password-reset/confirm", "/forbidden", "/setup"]}
      sidebarFooter={<UserFooter />}
    >
      {children}
    </BaseAppShell>
  );
}

/** ログインユーザー表示とログアウト。next-auth 依存のためアプリ側に置く。 */
function UserFooter() {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <div className="mt-auto border-t border-[#e5e5e5] px-4 py-3">
      <div className="mb-2 truncate text-xs text-[#707070]">
        {session.user.companyName}
        <span className="mx-1 text-[#c8c8c8]">/</span>
        {session.user.name}
      </div>
      <a
        href="https://portal.paloma-pf.com/?contact=jinji"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
      >
        <Mail className="h-4 w-4" />
        お問い合わせ
      </a>
      <button
        onClick={() => {
          void signOut({ redirect: false }).then(() => {
            window.location.href = "https://portal.paloma-pf.com/";
          });
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
      >
        <LogOut className="h-4 w-4" />
        ログアウト
      </button>
    </div>
  );
}

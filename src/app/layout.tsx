import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import AppShell from "@/components/AppShell";
import { getOptionalGrant } from "@/lib/session";

/**
 * 本文フォント。OS標準任せだと Mac=ヒラギノ / Windows=メイリオ で見え方が変わるため、
 * PFシリーズ共通のフォントを配信して両OSで同じ表示にする（ポータルと同じ Noto Sans JP）。
 */
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "PF人事マスター",
  description:
    "生産・調達統括本部の人事マスター。人事情報・組織図・異動申請書・人事考課・基本給与・資格を一元管理（管理者専用）",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PF人事マスター", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  // 人事情報を扱うため、検索エンジンには一切載せない
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ナビの出し分けにだけ使う（実際のアクセス制御は各ページ・各アクション側で毎回行う）
  const grant = await getOptionalGrant();

  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body className="antialiased">
        <Providers>
          <AppShell
            canPayroll={grant?.canPayroll ?? false}
            canEvaluation={grant?.canEvaluation ?? false}
            isOwner={grant?.isOwner ?? false}
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}

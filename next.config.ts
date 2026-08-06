import type { NextConfig } from "next";

// PF人事管理。Vercel での通常 SSR ビルド。
// オンプレ Docker ビルド時のみ BUILD_STANDALONE=1 で standalone 出力（クラウドビルドには影響しない）。
const nextConfig: NextConfig = {
  // 共通UIパッケージは TSX をそのまま配布しているためトランスパイルする
  transpilePackages: ["@paloma-pf/ui"],
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      // 取込は Server Action にファイルを渡す。既定の上限は 1MB で、
      // 名簿・賞与マスタ（1,700名で 1.1MB）が入らず
      // 「An unexpected response was received from the server.」になる。
      // Vercel のリクエスト本文の上限が 4.5MB なので、その手前まで上げる。
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;

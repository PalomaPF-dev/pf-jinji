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
};

export default nextConfig;

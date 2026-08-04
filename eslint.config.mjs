// eslint-config-next 16 は flat config（配列）をそのまま公開しているため、
// FlatCompat を介さず直接読み込む。
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
];

export default eslintConfig;

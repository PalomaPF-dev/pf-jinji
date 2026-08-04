// eslint-config-next 16 は flat config（配列）をそのまま公開しているため、
// FlatCompat を介さず直接読み込む。
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // useActionState の第1引数（前回の状態）は使わないアクションが多い。
      // 先頭 _ を「意図的に使わない」印として扱う。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;

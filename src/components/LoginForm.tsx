"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Lock } from "lucide-react";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("error") === "sso" ? "ポータルからのログインに失敗しました。もう一度お試しください。" : "");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email: loginId, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      // authorize が throw したメッセージ（パスワード未設定など）はそのまま出す
      setError(
        res.error === "CredentialsSignin"
          ? "社員番号またはパスワードが違います。"
          : res.error,
      );
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="loginId" className="mb-1 block text-sm font-medium text-[#555555]">
          社員番号
        </label>
        <input
          id="loginId"
          name="loginId"
          autoComplete="username"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          required
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-[#555555]">
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />
      </div>
      {error && (
        <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
      >
        <Lock className="h-4 w-4" />
        {loading ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}

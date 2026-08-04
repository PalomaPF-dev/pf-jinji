"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

/**
 * 初期セットアップ（最初の1人＝人事の責任者を登録する）。
 * 利用許可名簿が空のときだけ表示される。
 */
export default function InitialSetupForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, name, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "登録に失敗しました。");
        setLoading(false);
        return;
      }
      const login = await signIn("credentials", { email: loginId, password, redirect: false });
      setLoading(false);
      if (login?.error) {
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="loginId" className="mb-1 block text-sm font-medium text-[#555555]">
          社員番号
        </label>
        <input
          id="loginId"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          required
          autoComplete="username"
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />
        <p className="mt-1 text-xs text-[#909090]">ポータルと同じ社員番号を使ってください。</p>
      </div>
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-[#555555]">
          お名前
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />
        <p className="mt-1 text-xs text-[#909090]">8文字以上。</p>
      </div>
      {error && <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
      >
        {loading ? "登録中…" : "登録して開始する"}
      </button>
    </form>
  );
}

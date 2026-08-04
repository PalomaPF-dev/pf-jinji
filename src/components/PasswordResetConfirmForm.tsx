"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/** 設定リンクからのパスワード設定。 */
export default function PasswordResetConfirmForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <p className="text-sm text-[#b91c1c]">
        リンクが正しくありません。人事の責任者に再発行を依頼してください。
      </p>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <p className="text-sm text-[#555555]">パスワードを設定しました。</p>
        <Link
          href="/login"
          className="mt-4 inline-flex rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          ログインへ
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("パスワードが一致しません。");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      setLoading(false);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "パスワードの設定に失敗しました。");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setLoading(false);
      setError("通信エラーが発生しました。");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-[#555555]">
          新しいパスワード
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
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-[#555555]">
          確認のためもう一度
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />
      </div>
      {error && <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#b91c1c]">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50"
      >
        {loading ? "設定中…" : "パスワードを設定"}
      </button>
    </form>
  );
}

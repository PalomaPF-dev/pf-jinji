"use client";

import { useFormStatus } from "react-dom";

/**
 * Server Action 用の送信ボタン。送信中は自動で無効化して二重送信を防ぐ。
 */
export default function SubmitButton({
  children,
  variant = "primary",
  className = "",
  confirm,
  name,
  value,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  /** 押下時に確認ダイアログを出す（発令適用・削除など戻せない操作用） */
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  const styles = {
    primary: "bg-[#2563eb] text-white hover:bg-[#1d4ed8]",
    secondary: "border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]",
    danger: "bg-[#dc2626] text-white hover:bg-[#b91c1c]",
  }[variant];

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`${base} ${styles} ${className}`}
    >
      {pending ? "処理中…" : children}
    </button>
  );
}

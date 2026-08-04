import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-lg font-bold text-[#333333]">ページが見つかりません</h1>
      <p className="mt-2 text-sm text-[#707070]">URL が変更されたか、削除された可能性があります。</p>
      <Link
        href="/"
        className="mt-6 inline-flex rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
      >
        ダッシュボードへ
      </Link>
    </div>
  );
}

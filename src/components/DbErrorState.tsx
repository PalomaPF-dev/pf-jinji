import { AlertTriangle } from "lucide-react";

/**
 * DB 未設定・接続失敗時の案内。ページを白紙にせず、何をすればよいか出す。
 */
export default function DbErrorState({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-[#f0d9d9] bg-[#fdf6f6] p-6">
      <div className="mb-2 flex items-center gap-2 text-[#b91c1c]">
        <AlertTriangle className="h-5 w-5" />
        <h2 className="font-bold">データベースに接続できません</h2>
      </div>
      <p className="text-sm text-[#707070]">
        環境変数 <code className="rounded bg-white px-1 py-0.5 text-xs">DATABASE_URL</code> の設定を確認してください。
      </p>
      {message && <p className="mt-2 break-all text-xs text-[#909090]">{message}</p>}
    </div>
  );
}

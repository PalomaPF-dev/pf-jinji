import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * ページ共通の見出し。左に戻り導線、右にアクションボタンを置ける。
 */
export default function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  actions,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {backHref && (
        <Link
          href={backHref}
          className="mb-2 inline-flex items-center gap-1 text-sm text-[#707070] hover:text-[#333333]"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? "戻る"}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#333333]">{title}</h1>
          {description && <p className="mt-1 text-sm text-[#707070]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

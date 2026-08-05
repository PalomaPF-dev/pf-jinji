import Link from "next/link";
import { Plus } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import { listOrgPlans } from "@/lib/orgPlans";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { NewOrgPlanForm } from "@/components/OrgPlanForms";

export const dynamic = "force-dynamic";

/**
 * 異動案の一覧。組織図の上で編成した案をここに溜め、
 * 確定すると対象者ぶんの異動申請書（J-426）が起案される。
 */
export default async function OrgPlansPage() {
  await requireJinjiSession();
  const plans = await listOrgPlans();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="異動案"
        description="組織図の上で配置を組み替え、まとめて異動申請書を起こします。"
        backHref="/org"
        backLabel="組織図へ戻る"
      />

      <section className="mb-6 rounded-xl border border-[#e5e5e5] bg-white p-5">
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[#333333]">
          <Plus className="h-4 w-4" />
          新しい案を作る
        </h2>
        <p className="mb-4 text-xs text-[#707070]">
          案の中で人を動かしても人事マスターは変わりません。確定したときに申請書が起案されます。
        </p>
        <NewOrgPlanForm />
      </section>

      {plans.length === 0 ? (
        <EmptyState title="異動案がありません" description="上のフォームから作成してください。" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">案の名前</th>
                <th className="px-4 py-3 font-medium">基準日</th>
                <th className="px-4 py-3 font-medium">発令予定日</th>
                <th className="px-4 py-3 font-medium">動かした人数</th>
                <th className="px-4 py-3 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3">
                    <Link href={`/org/plan/${p.id}`} className="font-medium text-[#2563eb] hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-[#909090]">{p.createdName ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(p.baseDate)}</td>
                  <td className="px-4 py-3 text-[#707070]">{formatDate(p.effectiveDate)}</td>
                  <td className="px-4 py-3 text-[#333333]">{p.moveCount} 名</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.status === "applied"
                          ? "bg-[#e8f3ec] text-[#1c7a4d]"
                          : "bg-[#f0f0f0] text-[#707070]"
                      }`}
                    >
                      {p.status === "applied" ? "申請書を作成済" : "編成中"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

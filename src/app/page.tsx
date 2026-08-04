import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, FileText, Network, Users } from "lucide-react";
import { isUnconfigured, requireJinjiSession } from "@/lib/session";
import { countByStatus } from "@/lib/employees";
import { countOpenTransfers, listDueTransfers } from "@/lib/transfers";
import { countExpiring, listQualifications } from "@/lib/qualifications";
import { listOrgUnits } from "@/lib/org";
import { daysUntil, todayJST } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { ExpiryBadge } from "@/components/Badges";
import DbErrorState from "@/components/DbErrorState";
import PageHeader from "@/components/PageHeader";
import { EMPLOYMENT_STATUS_LABEL, TRANSFER_KIND_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

function Stat({
  href,
  icon: Icon,
  label,
  value,
  sub,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[#e5e5e5] bg-white p-5 transition hover:border-[#2563eb]"
    >
      <div className="mb-2 flex items-center gap-2 text-[#909090]">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[#333333]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[#909090]">{sub}</div>}
    </Link>
  );
}

/** ダッシュボード。今なにをすべきかが一目で分かることを目的にしている。 */
export default async function HomePage() {
  // 名簿が空＝まだ誰も使えない状態。初期セットアップへ誘導する。
  try {
    if (await isUnconfigured()) redirect("/setup");
  } catch (e) {
    // redirect() は内部的に例外を投げるため、DB エラーだけを拾う
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <DbErrorState message={(e as Error).message} />
      </div>
    );
  }

  const s = await requireJinjiSession();
  const today = todayJST();

  const [statusCounts, openTransfers, dueTransfers, orgUnits, expiring, expiringList] = await Promise.all([
    countByStatus(),
    countOpenTransfers(),
    listDueTransfers(today),
    listOrgUnits(),
    countExpiring(today),
    listQualifications({ expiringOnly: true, today, withinDays: 90 }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader title="ダッシュボード" description={`${s.grant.name} さん、おつかれさまです。`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          href="/employees"
          icon={Users}
          label="在籍者"
          value={statusCounts.active}
          sub={`休職 ${statusCounts.leave} / 出向 ${statusCounts.loaned} / 退職 ${statusCounts.retired}`}
        />
        <Stat href="/org" icon={Network} label="組織" value={orgUnits.length} sub="登録されている組織単位" />
        <Stat
          href="/transfers"
          icon={FileText}
          label="未処理の異動申請"
          value={openTransfers}
          sub="起案中・申請中・承認済"
        />
        <Stat
          href="/qualifications?expiring=1"
          icon={Award}
          label="資格の期限"
          value={expiring.expired + expiring.soon}
          sub={`期限切れ ${expiring.expired} / 90日以内 ${expiring.soon}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 発令日が来ているのに未反映のもの */}
        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-1 text-sm font-bold text-[#333333]">発令待ちの異動</h2>
          <p className="mb-3 text-xs text-[#707070]">
            承認済みで適用日が来ているのに、人事マスターへ未反映のものです。
          </p>
          {dueTransfers.length === 0 ? (
            <p className="text-sm text-[#909090]">ありません。</p>
          ) : (
            <ul className="space-y-2">
              {dueTransfers.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/transfers/${t.id}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-[#f0e2c8] bg-[#fdfaf3] px-3 py-2 text-sm hover:bg-[#fdf6ea]"
                  >
                    <span className="font-mono text-xs text-[#707070]">{t.transferNo}</span>
                    <span className="font-medium text-[#333333]">{t.employeeName}</span>
                    <span className="text-xs text-[#707070]">{TRANSFER_KIND_LABEL[t.kind]}</span>
                    <span className="ml-auto text-xs text-[#a06a12]">
                      適用日 {formatDate(t.effectiveDate)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 資格の期限 */}
        <section className="rounded-xl border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-1 text-sm font-bold text-[#333333]">期限が近い資格</h2>
          <p className="mb-3 text-xs text-[#707070]">期限切れ、または90日以内に切れるものです。</p>
          {expiringList.length === 0 ? (
            <p className="text-sm text-[#909090]">ありません。</p>
          ) : (
            <ul className="space-y-2">
              {expiringList.slice(0, 8).map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm"
                >
                  <span className="font-medium text-[#333333]">{q.employeeName}</span>
                  <span className="text-xs text-[#707070]">{q.name}</span>
                  <span className="ml-auto">
                    <ExpiryBadge daysLeft={q.expiresOn ? daysUntil(q.expiresOn, today) : null} />
                  </span>
                </li>
              ))}
              {expiringList.length > 8 && (
                <li className="text-xs text-[#909090]">
                  <Link href="/qualifications?expiring=1" className="text-[#2563eb] hover:underline">
                    ほか {expiringList.length - 8} 件を見る
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {statusCounts.active === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-[#e5e5e5] bg-white p-6 text-center">
          <p className="font-medium text-[#555555]">まずは人事マスターを整えましょう</p>
          <p className="mt-1 text-sm text-[#909090]">
            組織図でポータルの部署を取り込み、社員台帳にCSVで社員を登録すると使い始められます。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/org/edit"
              className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
            >
              組織を設定する
            </Link>
            <Link
              href="/employees/import"
              className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              社員をCSV取込する
            </Link>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-[#909090]">
        在籍状態の内訳: {(Object.keys(statusCounts) as (keyof typeof statusCounts)[]).map((k) => `${EMPLOYMENT_STATUS_LABEL[k]} ${statusCounts[k]}`).join(" / ")}
      </p>
    </div>
  );
}

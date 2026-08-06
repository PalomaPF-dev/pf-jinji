import Link from "next/link";
import { requireJinjiSession } from "@/lib/session";
import { getScope } from "@/lib/scope";
import { activeOn, buildOrgTree, flattenTree, listOrgUnits, memberCountsByOrg } from "@/lib/org";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import { OrgCodeCreateForm, OrgCodeDeleteForm, OrgCodeRowForm } from "@/components/OrgCodeForms";
import { ORG_KIND_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 部署・職場の設定（名称とコード）。
 *
 * コードは2つの役目を持つ。
 *   1. 人事システムの台帳と突き合わせるための番号
 *   2. ポータルの部署・職場を作る／紐づけるときの鍵（hr_code）
 * 人事マスタのExcelを取り込むと入るが、組織が増えたとき・名前や番号が変わったときに
 * 取込を待たずに直せるよう、この画面から追加・修正・削除できるようにしてある。
 *
 * 名前を変えるとポータル側の部署・職場の名前も次の連携で変わる（コードで突き合わせるため、
 * ポータルのコード D001 等や、部署へのアプリ割当は変わらない）。
 */
export default async function OrgCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const s = await requireJinjiSession();
  const scope = await getScope(s.grant);
  const { q = "" } = await searchParams;
  const today = todayJST();

  const [units, counts] = await Promise.all([listOrgUnits(), memberCountsByOrg()]);
  const nameById = new Map(units.map((u) => [u.id, u.name]));
  // 配下の数。削除のときに「上へ移す」かどうかの判断に使う
  const childCount = new Map<string, number>();
  for (const u of units) {
    if (u.parentId) childCount.set(u.parentId, (childCount.get(u.parentId) ?? 0) + 1);
  }
  const inScope = units.filter((u) => scope.orgUnitIds === null || scope.orgUnitIds.includes(u.id));

  // 並びは部署コード → 職場コード（組織図・組織台帳と同じ見え方にする）。
  // コードが無いものは後ろにまとめて、入れ忘れが目に付くようにする
  const codeKey = (v: string | null) => v ?? "￿";
  const ordered = [...inScope].sort(
    (a, b) =>
      codeKey(a.deptCode).localeCompare(codeKey(b.deptCode)) ||
      codeKey(a.workplaceCode).localeCompare(codeKey(b.workplaceCode)) ||
      a.name.localeCompare(b.name, "ja"),
  );

  const needle = q.trim().toLowerCase();
  const rows = needle
    ? ordered.filter((u) =>
        [u.name, u.code, u.deptCode ?? "", u.workplaceCode ?? ""].some((v) =>
          v.toLowerCase().includes(needle),
        ),
      )
    : ordered;

  // 追加フォームの「上位組織」。工場スコープが掛かっている人には自分の範囲だけ出す
  const parentOptions = flattenTree(buildOrgTree(activeOn(units, today), counts, new Map())).filter(
    (o) => scope.orgUnitIds === null || scope.orgUnitIds.includes(o.id),
  );

  const withoutCode = inScope.filter((u) => !u.deptCode && !u.workplaceCode).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="部署・職場の設定"
        description={`${rows.length} 件${scope.scopeName ? `（${scope.scopeName}）` : ""}`}
        backHref="/org"
        backLabel="組織図へ戻る"
      />

      <div className="mb-5 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 text-xs text-[#707070]">
        <strong>組織名・部署コード・職場コード</strong>を直せます。コードは
        <strong>人事システムの台帳との突合</strong>と、
        <strong>ポータルの部署・職場との紐づけ</strong>に使う番号です。
        人事マスタのExcelを取り込むと自動で入りますが、組織が増えたときや名前・番号が
        変わったときはここで直せます。
        <br />
        名前を変えると、次のポータル連携で<strong>ポータル側の部署・職場の名前も変わります</strong>
        （突合はコードで行うため、ポータルの部署コード D001 等やアプリの割当は変わりません）。
        階層（上位組織）・組織の長は{" "}
        <Link href="/org/edit" className="text-[#2563eb] hover:underline">
          組織の編集
        </Link>{" "}
        で扱います。
        {withoutCode > 0 && (
          <>
            <br />
            現在 <strong>{withoutCode} 件</strong> の組織にコードが入っていません。
          </>
        )}
      </div>

      <div className="mb-5">
        <OrgCodeCreateForm parentOptions={parentOptions} />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#e5e5e5] bg-white p-4">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-[#707070]">
            検索（組織名・部署コード・職場コード）
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
        >
          絞り込む
        </button>
        {q && (
          <Link
            href="/org/codes"
            className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            解除
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
        <table className="w-full min-w-[860px] text-[13px] leading-5">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
              <th className="px-3 py-2 font-medium">区分</th>
              <th className="px-3 py-2 font-medium">上位組織</th>
              <th className="px-3 py-2 font-medium">在籍</th>
              <th className="px-3 py-2 font-medium">配下</th>
              <th className="px-3 py-2 font-medium">組織名 / 部署コード / 職場コード</th>
              <th className="px-3 py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                <td className="px-3 py-1.5 whitespace-nowrap text-[#555555]">
                  {ORG_KIND_LABEL[u.kind]}
                  <Link
                    href={`/org/edit?id=${u.id}`}
                    title="組織の編集（階層・組織の長）"
                    className="ml-2 font-mono text-[11px] text-[#2563eb] hover:underline"
                  >
                    {u.code}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-[#555555]">
                  {u.parentId ? (nameById.get(u.parentId) ?? "—") : "（最上位）"}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-[#707070]">{counts.get(u.id) ?? 0}</td>
                <td className="px-3 py-1.5 tabular-nums text-[#707070]">{childCount.get(u.id) ?? 0}</td>
                <td className="px-3 py-1.5">
                  <OrgCodeRowForm
                    id={u.id}
                    name={u.name}
                    deptCode={u.deptCode}
                    workplaceCode={u.workplaceCode}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <OrgCodeDeleteForm
                    id={u.id}
                    name={u.name}
                    childCount={childCount.get(u.id) ?? 0}
                    parentName={u.parentId ? (nameById.get(u.parentId) ?? null) : null}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#909090]">
                  該当する組織がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

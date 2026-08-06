import Link from "next/link";
import { Hash } from "lucide-react";
import { requireJinjiSession } from "@/lib/session";
import {
  activeOn,
  buildOrgTree,
  flattenTree,
  getOrgUnit,
  listOrgUnits,
  memberCountsByOrg,
  selfAndDescendantIds,
} from "@/lib/org";
import { listEmployeeOptions } from "@/lib/employees";
import { todayJST } from "@/lib/dates";
import PageHeader from "@/components/PageHeader";
import OrgUnitForm from "@/components/OrgUnitForm";
import OrgDeleteForm from "@/components/OrgDeleteForm";
import PortalSyncForm, { RestructureForm } from "@/components/PortalSyncForm";
import { ORG_KIND_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 組織の編集。上の欄で追加／選択中の組織を編集し、下の一覧から対象を選ぶ。
 * ポータル同期は責任者（owner）だけに出す。
 */
export default async function OrgEditPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const s = await requireJinjiSession();
  const { id } = await searchParams;
  const today = todayJST();

  const [units, counts, employees] = await Promise.all([
    listOrgUnits(),
    memberCountsByOrg(),
    listEmployeeOptions(),
  ]);
  const nodes = buildOrgTree(activeOn(units, today), counts, new Map());
  const editing = id ? await getOrgUnit(id) : null;
  // 編集中の組織自身とその配下は上位組織に選べない（選ばせてからエラーにするより分かりやすい）
  const excluded = editing ? selfAndDescendantIds(nodes, editing.id) : new Set<string>();
  const parentOptions = flattenTree(nodes).filter((o) => !excluded.has(o.id));
  const nameById = new Map(units.map((u) => [u.id, u.name]));
  const headNameById = new Map(employees.map((e) => [e.id, e.name]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="組織の編集"
        description="本部→部→課→係の階層と、組織の長を設定します。"
        backHref="/org"
        backLabel="組織図へ戻る"
        actions={
          <Link
            href="/org/codes"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <Hash className="h-4 w-4" />
            部署・職場コードの設定
          </Link>
        }
      />

      <div className="space-y-5">
        {s.grant.isOwner && <PortalSyncForm />}
        {s.grant.isOwner && <RestructureForm />}

        <OrgUnitForm
          key={editing?.id ?? "new"}
          unit={editing ?? undefined}
          parentOptions={parentOptions}
          employees={employees}
        />

        <section className="overflow-x-auto rounded-xl border border-[#e5e5e5] bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs text-[#707070]">
                <th className="px-4 py-3 font-medium">部署コード</th>
                <th className="px-4 py-3 font-medium">職場コード</th>
                <th className="px-4 py-3 font-medium">組織名</th>
                <th className="px-4 py-3 font-medium">区分</th>
                <th className="px-4 py-3 font-medium">上位組織</th>
                <th className="px-4 py-3 font-medium">組織の長</th>
                <th className="px-4 py-3 font-medium">在籍</th>
                <th className="px-4 py-3 font-medium">ポータル</th>
                <th className="px-4 py-3 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-4 py-3 font-mono text-xs text-[#707070]">{u.deptCode ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#707070]">
                    {u.workplaceCode ?? (/^\d{8}$/.test(u.code) ? u.code : "—")}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/org/edit?id=${u.id}`} className="font-medium text-[#2563eb] hover:underline">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{ORG_KIND_LABEL[u.kind]}</td>
                  <td className="px-4 py-3 text-[#555555]">
                    {u.parentId ? (nameById.get(u.parentId) ?? "—") : "（最上位）"}
                  </td>
                  <td className="px-4 py-3 text-[#555555]">
                    {u.headEmployeeId ? (headNameById.get(u.headEmployeeId) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3 text-[#707070]">{counts.get(u.id) ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-[#909090]">
                    {u.portalDeptCode ?? u.portalWorkplaceCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <OrgDeleteForm id={u.id} name={u.name} />
                  </td>
                </tr>
              ))}
              {units.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-[#909090]">
                    組織がまだありません。ポータルの部署を同期するか、上の欄から追加してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

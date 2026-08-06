import Link from "next/link";
import { ORG_KIND_LABEL, type OrgNode } from "@/lib/types";

/**
 * 組織図。ネストした ul/li と罫線で階層を描く。
 * SVG ではなく通常のフローに載せることで、印刷時にページを跨いでも崩れない。
 */
export default function OrgChart({ nodes }: { nodes: OrgNode[] }) {
  return (
    <ul className="space-y-3">
      {nodes.map((n) => (
        <OrgBranch key={n.id} node={n} />
      ))}
    </ul>
  );
}

function OrgBranch({ node }: { node: OrgNode }) {
  return (
    <li>
      <OrgCard node={node} />
      {node.children.length > 0 && (
        <ul className="mt-3 ml-4 space-y-3 border-l border-[#dcdcdc] pl-5 sm:ml-6 sm:pl-6">
          {node.children.map((c) => (
            <OrgBranch key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

function OrgCard({ node }: { node: OrgNode }) {
  return (
    <div className="relative inline-flex min-w-[240px] flex-col rounded-lg border border-[#e5e5e5] bg-white px-4 py-3">
      {/* 親からの横罫線（ルート以外） */}
      {node.depth > 0 && (
        <span
          aria-hidden
          className="absolute top-1/2 -left-5 h-px w-5 bg-[#dcdcdc] sm:-left-6 sm:w-6"
        />
      )}
      <div className="flex items-center gap-2">
        <span className="rounded bg-[#eef1fb] px-1.5 py-0.5 text-[10px] font-medium text-[#3b4fa8]">
          {ORG_KIND_LABEL[node.kind]}
        </span>
        <span className="font-medium text-[#333333]">{node.name}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#909090]">
        {/*
          人事システムのコード。部署コード（工場・部の識別子）と
          職場コード（所属組織の8桁）を出す。どちらも無い組織は内部コードを出す。
        */}
        {node.deptCode && <span className="font-mono">部署 {node.deptCode}</span>}
        {node.workplaceCode && <span className="font-mono">職場 {node.workplaceCode}</span>}
        {!node.deptCode && !node.workplaceCode && <span className="font-mono">{node.code}</span>}
        <span>
          長: {node.headName ? (
            <span className="text-[#555555]">{node.headName}</span>
          ) : (
            "—"
          )}
        </span>
        <Link href={`/employees?org=${node.id}`} className="text-[#2563eb] hover:underline">
          在籍 {node.memberCount} 名
          {node.totalCount !== node.memberCount && `（配下計 ${node.totalCount} 名）`}
        </Link>
      </div>
    </div>
  );
}

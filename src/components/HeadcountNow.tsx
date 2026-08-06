import { Fragment } from "react";
import Link from "next/link";
import type { HeadcountNow as Now } from "@/lib/headcount";

/**
 * いまの人数を、組織図（配置表）と同じ階層のまま出す。
 *
 * 列は配置表の第2〜第4階層に対応させている。どの列に名前があるかで階層が読めるので、
 * 字下げより誤解が少ない。
 *
 * 数は2列に分ける。1つの列に「その枠の人数」と「配下を含む人数」を混ぜると、
 * どちらの意味なのかが行ごとに変わって読めなくなるため。
 */

/** 枠1つぶんの行。level 0 = 部・工場（第2階層）、1 = 第3階層、2以降 = 第4階層。 */
function Row({
  name,
  level,
  own,
  total,
  bold,
}: {
  name: string;
  level: number;
  own: number;
  total: number | null;
  bold?: boolean;
}) {
  const col = Math.min(level, 2);
  return (
    <tr className="border-b border-[#f4f4f4] last:border-0">
      {[0, 1, 2].map((i) => (
        <td
          key={i}
          className={`px-2 py-1 ${
            i === col
              ? bold
                ? "font-medium text-[#333333]"
                : "text-[#555555]"
              : ""
          }`}
          // 第4階層より深い枠（配置表で人が足したもの）は字下げで表す
          style={
            i === col && level > 2 ? { paddingLeft: `${0.5 + (level - 2) * 0.75}rem` } : undefined
          }
        >
          {i === col ? name : ""}
        </td>
      ))}
      <td className="w-16 px-2 py-1 text-right tabular-nums text-[#555555]">{own || ""}</td>
      <td
        className={`w-16 px-2 py-1 text-right tabular-nums ${
          bold ? "font-medium text-[#333333]" : "text-[#909090]"
        }`}
      >
        {total ?? ""}
      </td>
    </tr>
  );
}

export default function HeadcountNow({ now }: { now: Now }) {
  if (now.groups.length === 0) {
    return <p className="text-sm text-[#909090]">対象の部署がありません。</p>;
  }

  return (
    <div>
      <div className="max-h-[520px] overflow-y-auto rounded-lg border border-[#e5e5e5]">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-[#fafafa] text-left text-xs text-[#707070]">
            <tr className="border-b border-[#e5e5e5]">
              <th className="w-48 px-2 py-2 font-medium">第2階層（部・工場）</th>
              <th className="w-48 px-2 py-2 font-medium">第3階層（室・共通・総務）</th>
              <th className="px-2 py-2 font-medium">第4階層（職場）</th>
              <th className="w-16 px-2 py-2 text-right font-medium">所属</th>
              <th className="w-16 px-2 py-2 text-right font-medium">計</th>
            </tr>
          </thead>
          <tbody>
            {now.groups.map((g) => (
              <Fragment key={g.orgId}>
                <Row name={g.name} level={0} own={g.own} total={g.total} bold />
                {g.units.map((u) => (
                  <Row
                    key={u.orgId}
                    name={u.name}
                    level={u.level}
                    own={u.own}
                    total={u.total === u.own ? null : u.total}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 合計は表の外に置く。中に入れると一番下までスクロールしないと見えないため */}
      <div className="mt-2 flex items-baseline justify-end gap-3 text-[13px]">
        <span className="font-medium text-[#333333]">合計</span>
        <span className="w-16 pr-2 text-right font-medium tabular-nums text-[#333333]">
          {now.total.toLocaleString()}名
        </span>
      </div>

      <p className="mt-2 text-xs text-[#909090]">
        「所属」はその枠に直接いる人数、「計」は配下を含む人数です。
      </p>

      {now.unassigned > 0 && (
        <p className="mt-1 text-xs text-[#a06a12]">
          所属が未設定の人が {now.unassigned} 名います。
          <Link href="/org" className="ml-1 text-[#2563eb] hover:underline">
            組織図で確認する
          </Link>
        </p>
      )}
    </div>
  );
}

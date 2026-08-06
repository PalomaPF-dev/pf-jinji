import Link from "next/link";
import type { HeadcountNow as Now } from "@/lib/headcount";

/**
 * いまの人数を部・工場ごとに出す。
 *
 * 部・工場は13前後だが、その配下の職場まで並べると200行を超えてダッシュボードが
 * 読めなくなる。そこで**部・工場の行は常に見せ、職場は開いたときだけ**出す
 * （details/summary なので JavaScript は要らない）。
 *
 * 各行には人数に比例した細い帯を添える。数字だけだと「どこが大きいか」を
 * 読み取るのに全行を見比べることになるため。
 */

function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span className="block h-1.5 w-full rounded-full bg-[#f0f0f0]">
      <span className="block h-1.5 rounded-full bg-[#2563eb]" style={{ width: `${w}%` }} />
    </span>
  );
}

export default function HeadcountNow({ now }: { now: Now }) {
  if (now.groups.length === 0) {
    return <p className="text-sm text-[#909090]">対象の部署がありません。</p>;
  }
  const max = Math.max(...now.groups.map((g) => g.total));

  return (
    <div>
      <ul className="divide-y divide-[#f0f0f0] border-y border-[#f0f0f0]">
        {now.groups.map((g) => {
          const head = (
            <>
              <span className="w-44 shrink-0 truncate text-[13px] font-medium text-[#333333]">
                {g.name}
              </span>
              <span className="min-w-0 flex-1">
                <Bar value={g.total} max={max} />
              </span>
              <span className="w-16 shrink-0 text-right text-[13px] font-medium tabular-nums text-[#333333]">
                {g.total.toLocaleString()}名
              </span>
            </>
          );
          // 配下が無い枠（本部の直属など）は開いても中身が無いので、ただの行にする
          if (g.units.length === 0) {
            return (
              <li key={g.orgId} className="flex items-center gap-3 py-2">
                <span className="w-4 shrink-0" />
                {head}
              </li>
            );
          }
          return (
            <li key={g.orgId}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 py-2 hover:bg-[#fafafa]">
                  <span className="w-4 shrink-0 text-center text-[10px] text-[#a0a0a0] group-open:rotate-90">
                    ▶
                  </span>
                  {head}
                </summary>

                <table className="mb-2 w-full text-[13px]">
                  <tbody>
                    {g.own > 0 && (
                      <tr className="text-[#707070]">
                        <td className="py-1 pl-11">{g.name}（直属）</td>
                        <td className="w-20 py-1 pr-1 text-right tabular-nums">{g.own}</td>
                      </tr>
                    )}
                    {g.units.map((u) => (
                      <tr key={u.orgId} className="text-[#555555]">
                        <td
                          className="py-1"
                          style={{ paddingLeft: `${2.75 + (u.level - 1) * 1}rem` }}
                        >
                          {u.name}
                          {u.total !== u.own && (
                            <span className="ml-2 text-[11px] text-[#a0a0a0]">
                              配下計 {u.total}
                            </span>
                          )}
                        </td>
                        <td className="w-20 py-1 pr-1 text-right tabular-nums">{u.own}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-3 text-[13px]">
        <span className="w-44 shrink-0 pl-7 font-medium text-[#333333]">合計</span>
        <span className="min-w-0 flex-1" />
        <span className="w-16 shrink-0 text-right font-medium tabular-nums text-[#333333]">
          {now.total.toLocaleString()}名
        </span>
      </div>

      {now.unassigned > 0 && (
        <p className="mt-2 text-xs text-[#a06a12]">
          所属が未設定の人が {now.unassigned} 名います。
          <Link href="/org" className="ml-1 text-[#2563eb] hover:underline">
            組織図で確認する
          </Link>
        </p>
      )}
    </div>
  );
}

import type { HeadcountTrend as Trend } from "@/lib/headcount";

/**
 * 部署ごとの人員推移。
 *
 * 部署は17前後あり、1枚の折れ線に重ねると読めない（線の見分けに色を7色以上使うことになる）。
 * そこで**表＋行ごとのスパークライン**にしている。数字は表が持ち、形はスパークラインが持つ。
 * 系列は行あたり1本なので凡例は要らない（見出しが何の線かを言っている）。
 */

const W = 96;
const H = 24;
const PAD = 3;

/** 12点のスパークライン。線は控えめな灰、直近だけアクセント色の点。 */
function Sparkline({ counts, labels, name }: { counts: number[]; labels: string[]; name: string }) {
  const n = counts.length;
  if (n < 2) return <span className="text-xs text-[#c8c8c8]">—</span>;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const flat = max === min;
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (n - 1);
  // 増減が無い行は真ん中に平らな線を引く（下端に貼り付くと「減った」ように見えるため）
  const y = (v: number) => (flat ? H / 2 : H - PAD - ((v - min) * (H - PAD * 2)) / span);
  const d = counts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = n - 1;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${name} の直近${n}ヶ月の人員推移。${min}名から${max}名。現在 ${counts[last]}名。`}
      className="block"
    >
      <path d={d} fill="none" stroke="#c8c8c8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* 直近の点。周りに2pxの白い輪を付けて線に重なっても見えるようにする */}
      <circle cx={x(last)} cy={y(counts[last])} r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
      {/* 月ごとの当たり判定。SVG 標準の title なので JS 無しで数字が読める */}
      {counts.map((v, i) => (
        <rect key={i} x={x(i) - (W / n) / 2} y={0} width={W / n} height={H} fill="transparent">
          <title>{`${labels[i].slice(0, 4)}年${Number(labels[i].slice(5))}月末 ${v}名`}</title>
        </rect>
      ))}
    </svg>
  );
}

const monthLabel = (l: string) => `${Number(l.slice(5))}月`;

export default function HeadcountTrend({ trend }: { trend: Trend }) {
  const { labels, rows, totals } = trend;
  if (rows.length === 0) {
    return <p className="text-sm text-[#909090]">対象の部署がありません。</p>;
  }
  const cols = labels.length;
  // 月の列は多いと横に伸びるので、直近6ヶ月だけ数字を出す（残りは推移で見る）
  const shown = Math.min(6, cols);
  const from = cols - shown;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[13px] leading-5">
        <thead>
          <tr className="border-b border-[#e5e5e5] text-left text-xs text-[#707070]">
            <th className="py-2 pr-3 font-medium">部署</th>
            <th className="px-2 py-2 font-medium">推移（{cols}ヶ月）</th>
            {labels.slice(from).map((l) => (
              <th key={l} className="px-2 py-2 text-right font-medium tabular-nums">
                {monthLabel(l)}
              </th>
            ))}
            <th className="py-2 pl-2 text-right font-medium">増減</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.orgId} className="border-b border-[#f0f0f0] last:border-0">
              <td className="py-1.5 pr-3 whitespace-nowrap text-[#333333]">{r.name}</td>
              <td className="px-2 py-1.5">
                <Sparkline counts={r.counts} labels={labels} name={r.name} />
              </td>
              {r.counts.slice(from).map((v, i) => (
                <td
                  key={i}
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    i === shown - 1 ? "font-medium text-[#333333]" : "text-[#707070]"
                  }`}
                >
                  {v}
                </td>
              ))}
              <td className="py-1.5 pl-2 text-right tabular-nums text-[#707070]">
                {r.delta === 0 ? "±0" : r.delta > 0 ? `＋${r.delta}` : `−${-r.delta}`}
              </td>
            </tr>
          ))}
          <tr className="border-t border-[#e5e5e5] bg-[#fafafa]">
            <td className="py-1.5 pr-3 font-medium text-[#333333]">合計</td>
            <td className="px-2 py-1.5">
              <Sparkline counts={totals} labels={labels} name="合計" />
            </td>
            {totals.slice(from).map((v, i) => (
              <td
                key={i}
                className={`px-2 py-1.5 text-right tabular-nums ${
                  i === shown - 1 ? "font-medium text-[#333333]" : "text-[#707070]"
                }`}
              >
                {v}
              </td>
            ))}
            <td className="py-1.5 pl-2 text-right tabular-nums text-[#707070]">
              {(() => {
                const d = (totals[cols - 1] ?? 0) - (totals[0] ?? 0);
                return d === 0 ? "±0" : d > 0 ? `＋${d}` : `−${-d}`;
              })()}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

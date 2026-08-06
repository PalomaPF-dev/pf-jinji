import { readFileSync, writeFileSync } from "node:fs";

/**
 * 指定帳票の原紙（Excel）を src/lib/templates/forms.ts へ埋め込み直す。
 *
 *   npx tsx scripts/embed-forms.mts <J-426(9)のxlsx> <J-456のxlsx>
 *
 * 原紙を差し替えるときだけ使う。埋め込みにしている理由は forms.ts の頭に書いてある。
 */
const [j426, j456] = process.argv.slice(2);
if (!j426 || !j456) {
  console.error("使い方: npx tsx scripts/embed-forms.mts <J-426(9).xlsx> <J-456.xlsx>");
  process.exit(1);
}

const chunk = (b64: string): string => {
  const lines = b64.match(/.{1,120}/g) ?? [];
  return lines.map((l, i) => `  "${l}"${i === lines.length - 1 ? ";" : " +"}`).join("\n");
};

const body = `/**
 * 指定帳票の原紙（Excel）。
 *
 * ファイルとして置かずに base64 で埋め込んでいるのは、サーバーレスの
 * 実行環境で「実行時にファイルが同梱されているか」が構成に左右されるため。
 * 埋め込んでおけば必ず読める。原紙を差し替えるときは
 * scripts/embed-forms.mts で作り直す。
 *
 * このファイルは自動生成。手で編集しない。
 */

const J426_B64 =
${chunk(readFileSync(j426).toString("base64"))}

const J456_B64 =
${chunk(readFileSync(j456).toString("base64"))}

/** 異動申請書 ・ 組織名称追加変更申請書（J-426(9)）の原紙 */
export const J426_TEMPLATE = (): Buffer => Buffer.from(J426_B64, "base64");

/** 高齢者雇用・アルバイト契約満了に伴う継続雇用申請書（J-456）の原紙 */
export const J456_TEMPLATE = (): Buffer => Buffer.from(J456_B64, "base64");
`;
writeFileSync("src/lib/templates/forms.ts", body);
console.log("src/lib/templates/forms.ts を書き出しました");

import { inflateRawSync } from "zlib";

/**
 * .xlsx を読むための最小限のリーダー（読み取り専用）。
 *
 * なぜ自前で書くか:
 * - 人事システムから出る名簿は Excel 形式で配られる。これを CSV に変換させると
 *   **社員番号の先頭ゼロが落ちる**（"001081" → 1081）。社員番号はポータルの
 *   login_id と突き合わせる鍵なので、桁が変わると連携が壊れる。
 * - 日本語版 Excel の「CSV」は既定が Shift-JIS で、文字化けの原因にもなる。
 * - 既存のライブラリ（exceljs 等）は書き込み機能のために依存が重く、
 *   読むだけの用途に対して脆弱性のある依存まで引き込む。
 *
 * 対応範囲は「セルの値を文字列として読む」ことに絞ってある。書式・数式・
 * 画像・シート保護などは扱わない（名簿の取込に要らないため）。
 */

export interface XlsxSheet {
  name: string;
  /** 行×列の文字列。空セルは "" で埋め、行内の欠けも詰めない */
  rows: string[][];
}

// ===== ZIP =====

/**
 * ZIP を展開する。xlsx は ZIP なので、中央ディレクトリを辿って各エントリを取り出す。
 * deflate(8) と 無圧縮(0) のみ対応（Excel が出すのはこの2つ）。
 */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();

  // 末尾から EOCD（End Of Central Directory, 0x06054b50）を探す。
  // コメントが付いていることがあるので、最大 64KB + 22 バイトさかのぼる。
  const maxBack = Math.min(buf.length, 0xffff + 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx として読めません（ZIPの終端が見つかりません）。");

  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // 中央ディレクトリの先頭

  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // ローカルヘッダは名前・拡張フィールドの長さが中央ディレクトリと違うことがあるので読み直す
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    try {
      out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    } catch {
      /* 読めないエントリは飛ばす（必要なものが欠ければ後段で気づく） */
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ===== XML =====

/** XML の実体参照を戻す。 */
function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * <si> や inlineStr の中身から本文だけを取り出す。
 *
 * 日本語の Excel はセルに**ふりがな**（<rPh>…</rPh>）を隠し持っていて、
 * その中にも <t> がある。単純に <t> を全部つなぐと「給与月額」が
 * 「給与月額キュウヨゲツガク」になり、見出しの突合が全滅する。
 * ふりがなを取り除いてから本文の <t> を連結する。
 */
function textOf(inner: string): string {
  const cleaned = inner
    .replace(/<rPh[\s\S]*?<\/rPh>/g, "")
    .replace(/<phoneticPr[^>]*\/>/g, "");
  let text = "";
  for (const t of cleaned.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
  return unescapeXml(text);
}

/**
 * 共有文字列表。Excel は同じ文字列を1か所にまとめ、セルからは添字で参照する。
 * リッチテキスト（<si> の中に <r> が複数）は連結して1つの文字列にする。
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push(textOf(m[1]));
  }
  return out;
}

/** "BC" → 54（0始まりの列番号）。 */
function colToIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** シートXMLを行×列の文字列に変換する。 */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
    // 空行は XML から丸ごと省かれる。r 属性（1始まりの行番号）で位置を合わせ、
    // 「Excel の7行目」がこちらでも rows[6] になるようにする。
    const rAttr = rowM[1].match(/\br="(\d+)"/);
    const rowAt = rAttr ? Number(rAttr[1]) - 1 : rows.length;
    while (rows.length < rowAt) rows.push([]);
    const cells: string[] = [];
    for (const cM of rowM[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cM[1];
      const body = cM[2];
      const refM = attrs.match(/r="([A-Z]+)\d+"/);
      const type = (attrs.match(/t="([^"]+)"/) ?? [])[1] ?? "n";

      let value = "";
      if (type === "s") {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        const i = v === undefined ? -1 : Number(v);
        value = shared[i] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        // 数値・文字列化された数式結果など。<v> をそのまま文字列として扱う
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        value = v === undefined ? "" : unescapeXml(v);
      }

      // 空セルは <c> ごと省略されるので、列参照を見て位置を合わせる
      const at = refM ? colToIndex(refM[1]) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    rows[rowAt] = cells;
  }
  return rows;
}

/**
 * 自己終了タグ（<c r="A1"/>）も含めて空セルを飛ばせるよう、
 * シートXMLの前処理で `<c ... />` を `<c ...></c>` に開いておく。
 */
function openSelfClosing(xml: string): string {
  return xml.replace(/<c([^>]*)\/>/g, "<c$1></c>");
}

// ===== 公開API =====

/**
 * xlsx を読み、全シートを文字列の表として返す。
 * シート名は workbook.xml の並び順（Excel のタブ順）で返す。
 */
export function readXlsx(buf: Buffer): XlsxSheet[] {
  const files = unzip(buf);

  const workbook = files.get("xl/workbook.xml")?.toString("utf8");
  if (!workbook) throw new Error("xlsx として読めません（workbook.xml がありません）。");

  // シート名と rId の対応
  const sheetDefs: { name: string; rid: string }[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = (m[1].match(/name="([^"]*)"/) ?? [])[1];
    const rid = (m[1].match(/r:id="([^"]*)"/) ?? [])[1];
    if (name && rid) sheetDefs.push({ name: unescapeXml(name), rid });
  }

  // rId → ファイルパス
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targetByRid = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = (m[1].match(/Id="([^"]*)"/) ?? [])[1];
    const target = (m[1].match(/Target="([^"]*)"/) ?? [])[1];
    if (id && target) targetByRid.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const out: XlsxSheet[] = [];
  for (let i = 0; i < sheetDefs.length; i++) {
    const def = sheetDefs[i];
    const path = `xl/${targetByRid.get(def.rid) ?? `worksheets/sheet${i + 1}.xml`}`;
    const xml = files.get(path)?.toString("utf8");
    if (!xml) continue;
    out.push({ name: def.name, rows: parseSheet(openSelfClosing(xml), shared) });
  }
  if (out.length === 0) throw new Error("xlsx にシートが見つかりません。");
  return out;
}

/**
 * 1行目をヘッダとみなして、各行を { 見出し: 値 } に変換する。
 * 見出しの前後空白と全角空白は落として突き合わせやすくする。
 */
export function sheetToObjects(sheet: XlsxSheet): Record<string, string>[] {
  const [header, ...body] = sheet.rows;
  if (!header) return [];
  const keys = header.map((h) => (h ?? "").replace(/[\s　]+/g, ""));
  return body
    .filter((r) => r.some((c) => (c ?? "").trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      keys.forEach((k, i) => {
        if (k) obj[k] = (r[i] ?? "").trim();
      });
      return obj;
    });
}

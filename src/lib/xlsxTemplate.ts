import { inflateRawSync } from "zlib";
import { zip } from "./xlsxWrite";

/**
 * 指定帳票の Excel（原紙）に値を差し込んで返す。
 *
 * なぜ「原紙をそのまま書き換える」のか:
 * 帳票は罫線・結合・列幅・印刷範囲まで含めて様式が決まっている。HTMLで作り直すと
 * どうしても寸法がずれるし、こちらで一から xlsx を組み立てると書式が落ちる。
 * **原紙のZIPを開いて、値の入るセルだけ差し替えて閉じ直す**のがいちばん安全で、
 * 様式は1ドットも動かない。
 *
 * 対応しているのは「セルに文字を入れる」ことだけ。行の挿入や書式の変更はしない
 * （やり出すと様式が崩れるので、原紙側を直してもらう）。
 */

// ===== ZIP を開く =====

/** xlsx（ZIP）を展開する。deflate と無圧縮のみ（Excel が出すのはこの2つ）。 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const maxBack = Math.min(buf.length, 0xffff + 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("原紙を読めません（ZIPの終端が見つかりません）。");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // ローカルヘッダは名前・拡張の長さが中央ディレクトリと違うことがあるので読み直す
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 展開したものを xlsx に戻す。[Content_Types].xml を先頭に置く（Excel の作法）。 */
export function rezip(files: Map<string, Buffer>): Buffer {
  const names = [...files.keys()].sort((a, b) =>
    a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : a < b ? -1 : 1,
  );
  return zip(names.map((path) => ({ path, data: files.get(path)! })));
}

// ===== セルへ値を入れる =====

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colIndex = (name: string): number => {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

const splitAddr = (addr: string): { col: string; row: number } => {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`セル番地が読めません: ${addr}`);
  return { col: m[1], row: Number(m[2]) };
};

/**
 * シートXMLのセルに文字列を入れる。
 *
 * - 既にあるセルは中身だけ差し替える（`s=`（書式）は残すので見た目は変わらない）
 * - 無いセルは行の中の正しい位置に足す。行ごと無ければ行から作る
 * - 値は **インライン文字列** で入れる。共有文字列表（sharedStrings）を触ると
 *   索引が全部ずれるので、原紙側の文字は一切動かさないこの形にしている
 * - 空文字を渡したセルは「消す」（原紙の下書き文字を消したいときに使う）
 */
export function setCells(sheetXml: string, values: Record<string, string>): string {
  let xml = sheetXml;

  for (const [addr, raw] of Object.entries(values)) {
    const { row } = splitAddr(addr);
    const text = raw ?? "";
    const cell =
      text === ""
        ? ""
        : `<c r="${addr}"__STYLE__ t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            text,
          )}</t></is></c>`;

    // 1) セルがすでにある → 中身を差し替える（書式はそのまま）
    const existing = new RegExp(`<c r="${addr}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    const hit = xml.match(existing);
    if (hit) {
      const style = (hit[1].match(/ s="\d+"/) ?? [""])[0];
      xml = xml.replace(existing, cell.replace("__STYLE__", style));
      continue;
    }
    if (text === "") continue; // 消すものが無い

    // 2) 行はある → 列の順に差し込む
    const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
    const rowHit = xml.match(rowRe);
    if (rowHit) {
      const body = rowHit[2];
      const target = colIndex(splitAddr(addr).col);
      let inserted = false;
      let next = "";
      let pos = 0;
      for (const m of body.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        if (!inserted && colIndex(m[1]) > target) {
          next += body.slice(pos, m.index!) + cell.replace("__STYLE__", "");
          pos = m.index!;
          inserted = true;
        }
      }
      next += body.slice(pos);
      if (!inserted) next += cell.replace("__STYLE__", "");
      xml = xml.replace(rowRe, `$1${next}$3`);
      continue;
    }

    // 3) 行ごと無い → 行番号の順に差し込む
    const newRow = `<row r="${row}">${cell.replace("__STYLE__", "")}</row>`;
    const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
    const after = rows.find((m) => Number(m[1]) > row);
    if (after) xml = xml.slice(0, after.index!) + newRow + xml.slice(after.index!);
    else xml = xml.replace("</sheetData>", `${newRow}</sheetData>`);
  }

  // 値を入れると Excel が「式の再計算」を求めることがあるので、計算結果の
  // キャッシュ（calcChain）は呼び出し側で捨てる。ここでは触らない。
  return xml;
}

// ===== チェックボックス =====

/**
 * Excel のフォームコントロール（チェックボックス）に印を付ける。
 *
 * 状態は2か所に持たれている。両方を揃えないと Excel と印刷で食い違う。
 *   - xl/ctrlProps/ctrlPropN.xml … `checked="Checked"`
 *   - xl/drawings/vmlDrawingN.vml … `<x:Checked>1</x:Checked>`
 *
 * どのコントロールがどの選択肢かは、シートの `<control name=...>` と
 * VML の `<x:Anchor>`（左上のセル）から突き合わせる。
 */
export interface CheckboxRef {
  /** シート上の名前（例 "Check Box 13"） */
  name: string;
}

/** シートXMLから「コントロール名 → ctrlProp のパス」を作る。 */
export function checkboxTargets(
  files: Map<string, Buffer>,
  sheetPath: string,
): Map<string, { ctrlProp: string; shapeId: string; vml: string }> {
  const sheet = files.get(sheetPath)?.toString("utf8") ?? "";
  const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const rels = files.get(relsPath)?.toString("utf8") ?? "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    relTarget.set(m[1], m[2].replace(/^\.\.\//, "xl/").replace(/^\//, ""));
  }
  const vmlPath =
    [...relTarget.values()].find((t) => /vmlDrawing\d+\.vml$/.test(t)) ?? "xl/drawings/vmlDrawing1.vml";

  const out = new Map<string, { ctrlProp: string; shapeId: string; vml: string }>();
  for (const m of sheet.matchAll(/<control shapeId="(\d+)" r:id="(rId\d+)" name="([^"]+)"/g)) {
    const target = relTarget.get(m[2]);
    if (!target) continue;
    out.set(m[3], { ctrlProp: target, shapeId: m[1], vml: vmlPath });
  }
  return out;
}

/** 指定した名前のチェックボックスに印を付ける。 */
export function checkBoxes(files: Map<string, Buffer>, sheetPath: string, names: string[]): void {
  if (names.length === 0) return;
  const targets = checkboxTargets(files, sheetPath);
  const vmlEdits = new Map<string, Set<string>>(); // vmlパス → 印を付ける shapeId

  for (const name of names) {
    const t = targets.get(name);
    if (!t) continue;

    const props = files.get(t.ctrlProp)?.toString("utf8");
    if (props && !/checked="/.test(props)) {
      files.set(
        t.ctrlProp,
        Buffer.from(props.replace("<formControlPr ", '<formControlPr checked="Checked" '), "utf8"),
      );
    }
    const set = vmlEdits.get(t.vml) ?? new Set<string>();
    set.add(t.shapeId);
    vmlEdits.set(t.vml, set);
  }

  for (const [path, ids] of vmlEdits) {
    const vml = files.get(path)?.toString("utf8");
    if (!vml) continue;
    let next = vml;
    for (const id of ids) {
      const shapeRe = new RegExp(`(<v:shape[^>]*id="_x0000_s${id}"[\\s\\S]*?)</x:ClientData>`);
      next = next.replace(shapeRe, (whole, head: string) =>
        /<x:Checked>/.test(head) ? whole : `${head}<x:Checked>1</x:Checked></x:ClientData>`,
      );
    }
    files.set(path, Buffer.from(next, "utf8"));
  }
}

/**
 * 原紙に値を差し込んで xlsx を返す。
 * calcChain は消す（値を入れ替えたあとの再計算で Excel が警告を出さないように）。
 */
export function fillTemplate(
  template: Buffer,
  opts: { sheetPath?: string; cells: Record<string, string>; checked?: string[] },
): Buffer {
  const files = unzip(template);
  const sheetPath = opts.sheetPath ?? "xl/worksheets/sheet1.xml";
  const sheet = files.get(sheetPath);
  if (!sheet) throw new Error(`原紙にシートがありません: ${sheetPath}`);

  files.set(sheetPath, Buffer.from(setCells(sheet.toString("utf8"), opts.cells), "utf8"));
  if (opts.checked?.length) checkBoxes(files, sheetPath, opts.checked);
  files.delete("xl/calcChain.xml");
  return rezip(files);
}

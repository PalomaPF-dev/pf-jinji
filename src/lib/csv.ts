// ===== CSV 生成／取込ユーティリティ =====

type Cell = string | number | null | undefined;

/** 1セルを CSV エスケープ。先頭が =,+,-,@ の場合は数式インジェクション対策で ' を前置。 */
function escapeCell(value: Cell): string {
  let s = value == null ? "" : String(value);
  // CSV インジェクション（Excel 等で数式として評価される）対策
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * ヘッダ＋行を CSV 文字列に。改行は CRLF、Excel(日本語)文字化け防止に UTF-8 BOM を付与。
 */
const BOM = String.fromCharCode(0xfeff);

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(","));
  return BOM + lines.join("\r\n");
}

/**
 * CSV テキストを行の配列にパースする（RFC4180 準拠の範囲）。
 * - 先頭の BOM は取り除く
 * - 引用符内の , と改行はデータとして扱い、"" は 1 個の " に戻す
 * - 改行は CRLF / LF / CR のいずれでもよい
 * - 完全に空の行は読み飛ばす（末尾の改行で空行が出るため）
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // 「1列だけで中身が空」= 空行として捨てる
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === ",") {
      endCell();
    } else if (c === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") {
      endRow();
    } else {
      cell += c;
    }
  }
  // 最終行（末尾に改行が無い場合）
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * ヘッダ行つき CSV を「ヘッダ名 → 値」のオブジェクト配列にする。
 * ヘッダ名は前後の空白を落として比較する（Excel 出力の空白ゆらぎ対策）。
 * 列数が足りない行は空文字で埋める。
 */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
}

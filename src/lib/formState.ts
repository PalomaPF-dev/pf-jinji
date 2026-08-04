/**
 * フォーム送信値の持ち回り。
 *
 * React 19 は Server Action の完了後にフォームを**自動リセット**する。そのため
 * 入力エラーで差し戻すと、defaultValue のままでは利用者が書いた内容が全部消える。
 * 異動申請書のような長いフォームでこれをやると実務にならないので、
 * 送信値をアクションの戻り値に載せ、それを defaultValue に反映して復元する。
 */

export type FormValues = Record<string, string>;

/**
 * FormData から文字列項目だけを取り出す。
 * File（CSV取込など）は復元対象にならないので落とす。
 */
export function formValues(form: FormData): FormValues {
  const out: FormValues = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * 表示に使う値を決める: 直前の送信値 → 保存済みの値 → 空。
 */
export function pick(values: FormValues | undefined, key: string, saved: string | null | undefined): string {
  if (values && key in values) return values[key];
  return saved ?? "";
}

/**
 * 同じ name を複数持つ入力（チェックボックス群）を1つの値として畳む。
 *
 * formValues() は FormData.entries() を回すので、同名キーは最後の1つで
 * 上書きされてしまう。単身赴任事由のような複数選択はそれでは復元できないため、
 * カンマ区切りにまとめて同じキーへ入れ直す。
 */
export function withMulti(values: FormValues, form: FormData, keys: string[]): FormValues {
  const out = { ...values };
  for (const key of keys) {
    out[key] = form
      .getAll(key)
      .map((v) => v.toString())
      .join(",");
  }
  return out;
}

/** withMulti() で畳んだ値を数値の配列に戻す。 */
export function pickMulti(values: FormValues | undefined, key: string, saved: number[]): number[] {
  if (!values || !(key in values)) return saved;
  return values[key]
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0);
}

# デプロイ手順（Vercel）

本番は **https://jinji.paloma-pf.com**。他のPFアプリと同じ `paloma-pf.com` ゾーンに置く。

以下は上から順に実施する。所要 15〜20 分程度。

---

## 1. データベースを用意する（Neon）

**pf-jinji 専用のプロジェクトを新規作成する。** 他のPFアプリのDBを流用してはいけない。
給与・人事考課を他アプリのDBから物理的に分離するのが、このアプリの設計上の前提になっている。

1. https://console.neon.tech で新規プロジェクト（例: `pf-jinji`）を作成
2. リージョンは他のPFアプリと揃える（Tokyo / `ap-southeast-1` 等）
3. 接続文字列（`postgres://…?sslmode=require`）を控える → `DATABASE_URL`

テーブルは初回アクセス時に冪等作成される（`src/lib/schema.ts`）ので、
事前のマイグレーション実行は不要。

---

## 2. Vercel プロジェクトを作る

1. https://vercel.com/new から `PalomaPF-dev/pf-jinji` をインポート
2. Framework Preset は **Next.js**（自動検出される）
3. Build / Output の設定は既定のまま（`next build`）
4. Root Directory も既定のまま（リポジトリ直下）

`vercel.json` に資格の期限アラート用 cron（毎日 0:00 UTC に `/api/cron/alerts`）を
定義してあるので、Vercel 側での追加設定は要らない。

> **Production ブランチについて**
> Vercel は既定でリポジトリのデフォルトブランチ（`main`）を Production として扱う。
> アプリ本体が `main` に入っていない状態でインポートすると、README だけの
> ビルドになって失敗する。`main` へマージしてからインポートするか、
> Settings → Git → Production Branch を作業ブランチに向けること。

---

## 3. 環境変数を入れる

Vercel の Settings → Environment Variables で、**Production / Preview の両方**に設定する。

| 変数 | 値 | 必須 |
|---|---|---|
| `DATABASE_URL` | 手順1の Neon 接続文字列 | ● |
| `NEXTAUTH_URL` | `https://jinji.paloma-pf.com` | ● |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` の出力 | ● |
| `PF_PROVISION_KEY` | **ポータルと同じ値**（既存のPFアプリの環境変数からコピー） | ポータル連携時 |
| `PORTAL_BASE_URL` | `https://portal.paloma-pf.com` | 既定値と同じなら省略可 |
| `JINJI_BOOTSTRAP_ADMIN_IDS` | 初期責任者の社員番号（カンマ区切り） | 任意 |
| `PF_ADMIN_BOOTSTRAP_HASH` | 統一管理者 `admin` の bcrypt ハッシュ | 任意 |
| `CRON_SECRET` | `openssl rand -hex 32` の出力 | 資格アラート利用時 |
| `ALERT_LEAD_DAYS` | 既定 `90,30,7` | 任意 |

注意点:

- **`NEXTAUTH_URL` は実際に配信するURLと必ず一致させる。**
  パスワード設定リンクの生成にもこの値を使うため、ずれると届かないドメインを指すリンクを発行してしまう。
- **`PF_PROVISION_KEY` はポータルと1文字でも違うと SSO が通らない。**
  失敗時は Vercel の Function ログに `[sso] rejected: 署名が一致しない…` が出る。
- `CRON_SECRET` 未設定のとき `/api/cron/alerts` は 503 を返して無効化される（誤って公開されない）。

---

## 4. ドメインを割り当てる

1. Vercel の Settings → Domains に `jinji.paloma-pf.com` を追加
2. 表示された DNS レコードを `paloma-pf.com` のゾーンに登録する
   （サブドメインなので通常は `jinji` の CNAME → `cname.vercel-dns.com`）
3. 証明書が発行され、Valid になるまで待つ

他のPFアプリと同じゾーンなので、`tenchu` や `hoju` を追加したときと同じ手順になる。

---

## 5. ポータル側を本番へ反映する

`pf-portal` の以下の変更が本番に出ていないと、ポータルのタイルとSSOがつながらない。

| ファイル | 内容 |
|---|---|
| `lib/db.js` | `ALL_APP_KEYS` に `"jinji"` |
| `lib/appUrls.js` | `APP_BASE_URLS.jinji = "https://jinji.paloma-pf.com"` |
| `lib/provision.js` | `PROVISION_APP_KEYS` に `"jinji"` |
| `api/user.js` | `SSO_APP_KEYS` に `"jinji"` |
| `index.html` / `admin.html` | `APPS` のタイル定義と `SSO_APPS` |
| `icons/jinji.png` | タイル用アイコン |
| `api/hr-sync.js` | 人事情報の受け口（新規） |

さらにポータルの部署マスターで、**管理者部署にだけ** `jinji` を割り当てる。
一般社員の部署に付けると、使えないタイルが全員に見えてしまう。

---

## 6. 動作確認

1. `https://jinji.paloma-pf.com/` を開く → 名簿が空なら `/setup` に誘導される
   （`JINJI_BOOTSTRAP_ADMIN_IDS` を設定した場合はその社員番号が owner 済み）
2. `/setup` で責任者を登録し、ログインできることを確認
3. `/org/edit` の「ポータルから同期」で部署・職場が取り込まれる
4. `/employees/import` に [sample-employees.csv](sample-employees.csv) を取り込む
5. `/transfers` で異動申請を1件作り、申請→承認→発令まで通す
6. `/settings` の「ポータル連携」→「連携内容を確認」で送信内容を点検してから送る
7. ポータルにログインし、タイルから SSO で入れることを確認

名簿に載っていない社員番号でログインすると `/forbidden` に出る。
これは正常な挙動で、アプリが管理者専用である証拠になる。

---

## つまずいたときの見どころ

| 症状 | 確認する場所 |
|---|---|
| ポータルのタイルから入ると `/login?error=sso` に戻る | Vercel の Function ログ。`[sso] rejected:` の後ろに理由が出る |
| 全ページが 500 | `DATABASE_URL`。Neon の接続文字列に `?sslmode=require` が付いているか |
| ログインできるが全部 `/forbidden` | 利用許可名簿（`jinji_admins`）が空。`/setup` へ |
| パスワード設定リンクが別ドメインを指す | `NEXTAUTH_URL` が本番URLと一致していない |
| ポータル連携が「404」 | ポータル本番に `api/hr-sync.js` が出ていない（手順5） |

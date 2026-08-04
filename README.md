# PF人事マスター（paloma-pf-jinji）

生産・調達統括本部の**人事マスター**。人事情報の原本を持ち、組織図の形成・異動申請書の作成・
人事考課・基本給与・資格までを一元管理する、**管理者専用**の社内業務アプリ。
PFシリーズ（ポータル `pf-portal` 配下）の一員として、ポータルの部署マスターおよび
SSO・権限の枠組みと連動する。

## 機能

1. **人事マスター** — 社員台帳（社員番号・氏名・生年月日・入社日・雇用体系・所属・役職・職務・等級・在籍状態）。CSV入出力。
2. **組織図の形成** — 本部→部→課→係の階層を持つ組織ツリー。ポータルの部署・職場を取り込み、階層・並び順・上長は人事側で管理する。基準日を指定した組織図の表示・印刷。
3. **異動申請書** — 指定フォームの入力内容を帳票として反映し、承認後に人事マスター・組織図へ適用する。年度連番（`J26-001`）で採番。
4. **人事考課** — 評価期（年度＋上期/下期）ごとの一次・二次評価。項目マスターは設定画面で増減できる。
5. **基本給与** — 改定履歴を積み上げる履歴型。最新の有効行が現在の給与。
6. **資格** — 保有資格と有効期限。期限接近を日次でアラート。

## アクセス制御

人事情報は本部で最も機微なデータのため、**二段構え**にしている。

| ゲート | 内容 |
|---|---|
| 1. ログイン | 社員番号＋パスワード（next-auth）、またはポータルからのSSO（`/api/sso`） |
| 2. 利用許可名簿 | `jinji_admins` テーブル。**ここに載っていない社員番号は、ログインできてもアプリを使えない**（`/forbidden`） |

名簿の各行は次の権限を持つ。既定は人事マスター・組織図・異動申請のみで、給与と考課は個別に許可する。

- `is_owner` — 名簿自体を編集できる（人事の責任者）。給与・考課も常に閲覧可
- `can_payroll` — 基本給与の閲覧・編集
- `can_evaluation` — 人事考課の閲覧・編集

権限判定は**毎回 DB を引く**（JWT には載せない）。権限を外した瞬間から、手元に残っている
セッションでも操作できなくなる。

さらに、給与・考課は**閲覧も**監査ログ（`jinji_audit_logs`）に記録する。

## 技術スタック

- Next.js 16（App Router／Server Components＋Server Actions）
- Neon Postgres（**pf-jinji 専用DB**。給与・考課を他アプリのDBから物理的に分離）／ node-postgres（`DB_DRIVER` 自動判定）
- next-auth v4（社員番号＋パスワード／JWT。クッキー名はアプリ固有 `jinji.session-token`）
- Tailwind CSS v4 / lucide-react / 共通UI `@paloma-pf/ui`（AppShell）

## 開発

```bash
npm install
npm run dev        # http://localhost:5190
npm run typecheck
npm run lint
npm run build
```

`.env.local` は [.env.local.example](.env.local.example) を参照。最低限 `DATABASE_URL` と
`NEXTAUTH_SECRET` があれば動く。テーブルは初回アクセス時に冪等作成される（`src/lib/schema.ts`）。

初回は利用許可名簿が空のため `/setup` に誘導され、最初の1人（owner）を登録する。
`JINJI_BOOTSTRAP_ADMIN_IDS` を設定した環境では、その社員番号が owner として自動登録される。

## ポータル連携

### このアプリ側（実装済み）

| 経路 | 内容 |
|---|---|
| `GET /api/sso?token=…` | ポータルからのSSO。`PF_PROVISION_KEY` で HMAC 検証。名簿に無ければ `/forbidden` へ |
| `POST /api/provision` | ポータルからの一括アカウント発行（PFシリーズ共通契約 v2.1） |
| 部署マスター取込 | ポータルの公開 `GET /api/departments` を取り込み、組織ツリーへ upsert |

### ポータル（`pf-portal`）側に必要な変更

`jinji` をポータルのアプリとして登録するには、ポータル側で以下の追加が必要（このリポジトリの範囲外）。

| ファイル | 変更内容 |
|---|---|
| `lib/db.js` | `ALL_APP_KEYS` に `"jinji"` |
| `lib/appUrls.js` | `APP_BASE_URLS.jinji = "https://jinji.paloma-pf.com"` |
| `lib/provision.js` | `PROVISION_APP_KEYS` に `"jinji"` |
| `api/user.js` | `SSO_APP_KEYS` に `"jinji"` |
| `index.html` / `admin.html` | `APPS` にタイル定義、`SSO_APPS` に追加 |
| 部署マスター | **管理者部署（D999 等）にだけ** `jinji` を割り当てる |

上記が入るまでの間も、本アプリは自前ログインとCSV取込だけで完結して運用できる。

## 運営

Paloma

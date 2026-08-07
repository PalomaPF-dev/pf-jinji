# ポータルの受け口 `POST /api/hr-sync`

PF人事管理（`pf-jinji`）を**人のマスター**とし、ポータル（`pf-portal`）のユーザーを
同期するための受け口。

**実装済み**: `pf-portal` の `api/hr-sync.js`。

## 何を同期するか（2026-08 に絞り込み）

送るのは**人に関する4つだけ**。部署・工場そのものはポータルで設定する。

| 情報 | マスター | 連携 |
|---|---|---|
| アカウントの存在（社員番号） | **人事管理** | 人事管理 → ポータル（`createMissing`。パスワード未設定で発行） |
| 氏名 | **人事管理** | 人事管理 → ポータル |
| 在籍状態（在籍／休職／出向／退職・退職日） | **人事管理** | 人事管理 → ポータル |
| 管理者（承認者） | **人事管理** | 人事管理 → ポータル（`managerLoginId` → `approver_user_id`） |
| 部署・工場そのもの（コード・名称・親子）とアプリ割当 | **ポータル** | 連携しない |
| ユーザーの所属部署・職場 | **ポータル** | 連携しない（退職時に外すのみ） |
| パスワード・権限（role / can_manage） | **ポータル** | 連携しない |
| 組織の階層（本部→部・工場→室→職場）・組織の長 | **人事管理** | 人事管理が保持（ポータルへは送らない） |

以前は `organizations` で部署・職場まで作っていたが、人事の組織はポータルの
アプリ割当の単位と一致せず二重管理になっていたため、やめた。
古い版が `organizations` を送っても**エラーにはならず、受け取らずに無視する**。

### 管理者（承認者）の決め方

人事管理が組織と職務から機械的に決める（`src/lib/portalManagers.ts`）。
管理者になる職務は次の6つだけ。

```
部門長 ＞ 工場長A ＞ 工場長B ＞ 室長 ＞ グループ長 ＝ 安全推進工場長室
```

自分の所属から組織を上へ辿り、**自分より上位の管理者**が最初に見つかったところで止める。
安全推進工場長室はグループ長と同じ高さなので、その人たちの管理者は工場長になる。

## リクエスト

```http
POST /api/hr-sync
Content-Type: application/json

{
  "key": "<PF_PROVISION_KEY>",
  "createMissing": true,
  "employees": [
    {
      "loginId": "016037",
      "name": "製造 一郎",
      "status": "active",
      "retireDate": null,
      "managerLoginId": "007335"
    }
  ]
}
```

| 項目 | 必須 | 説明 |
|---|---|---|
| `key` | ○ | `PF_PROVISION_KEY`。タイミング安全に比較する |
| `createMissing` | | `true` でポータル未登録の社員をパスワード未設定・**部署未設定**で作る |
| `employees[].loginId` | ○ | 社員番号（＝ポータルの `login_id`） |
| `employees[].name` | | 氏名。空なら既存の氏名を残す |
| `employees[].status` | | `active` / `leave` / `loaned` / `retired`。既定は `active` |
| `employees[].retireDate` | | 退職日（`YYYY-MM-DD`）。`retired` のときだけ保存する |
| `employees[].managerLoginId` | | 管理者の社員番号。ポータルの `approver_user_id` に反映する |

1回に送れるのは 2,000 名まで。人事管理側は 400 名ずつに分けて送る。

## ポータル側の挙動

1. `login_id` をキーに upsert する。既存行では
   `role` / `can_manage` / `password_hash` / `department_id` / `workplace_id` に**触れない**
2. `hr_status` / `retire_date` を更新する（管理画面に「休職」「出向」「退職」の目印が出る）
3. **退職者は所属を外す**（`department_id` / `workplace_id` を NULL）。
   部署の apps 割当から外れるので、各アプリの利用条件を満たさなくなる。
   アカウント自体は名簿に残る（各アプリ側のアカウントも消えない）
4. 全員の行が揃ってから `managerLoginId` を `approver_user_id` に反映する
   （管理者本人が同じ連携で作られていることがあるため）

各アプリへの再連携（`provisionUsers`）はこの受け口では行わない。
アプリの利用可否は**部署の apps 割当**で決まり、その部署はポータルで設定するため、
部署を割り当てた時点（ユーザー編集の保存・一括再連携）に連携される。

## レスポンス

```json
{
  "results": [
    { "loginId": "016037", "status": "updated", "reprovisioned": false, "approverSet": true }
  ],
  "organizations": { "created": 0, "linked": 0, "updated": 0, "adminSet": 0, "ignored": 0, "errors": [] },
  "affiliationCleared": 1,
  "approverSet": 4
}
```

`status` は `created` / `updated` / `skipped` / `error`。
`skipped` は「ポータルに未登録（`createMissing` なし）」「退職者のため作成しない」のいずれか。

## 部署設定をやり直す

ポータルの管理画面「① 職場設定」に**一括削除**の入口がある
（`POST /api/departments-reset`、管理セッション必須）。

- `keepCodes` に無い部署をすべて削除する。既定は `["D999"]`（開発者・管理者用）
- 配下の職場も一緒に消える
- ユーザーは**名簿に残る**。部署・職場が未設定に戻るだけで、パスワード・権限・承認者はそのまま
- 各アプリ側のアカウントは消えない
- `confirm: "削除"` を付けないと**下見だけ**返す（何も消さない）

## 運用

人事管理の `/settings` →「ポータル連携」から手で実行する。
異動を発令したときは、対象者だけが自動で送られる。

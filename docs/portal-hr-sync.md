# ポータル側に追加する受け口 `POST /api/hr-sync`

PF人事管理（`pf-jinji`）を**人のマスター**とし、ポータル（`pf-portal`）へ人事情報を
連携するための受け口。

**実装済み**: `pf-portal` の `claude/hr-master-app-dev-hvif4t` ブランチに
`api/hr-sync.js` として入っている。本書はその仕様と、同じ内容の参照実装。

## なぜ必要か

人事管理で異動を発令しても、ポータルの所属が古いままだと各業務アプリの部署・権限が
追従しない。この受け口を入れると、次の流れが成立する。

```
人事管理で異動を発令
  → 人事管理が POST /api/hr-sync でポータルへ所属を送る
  → ポータルが pf_portal_users を更新
  → ポータルが既存の provisionUsers() で各業務アプリへ再連携
  → 各アプリの部署・権限が追従する
```

## 責務の分担

| 情報 | マスター | 連携方向 |
|---|---|---|
| 氏名・所属・役職・職務・生年月日・入社日・雇用体系・在籍状態 | **人事管理** | 人事管理 → ポータル |
| 部署・職場そのものの存在（コード・名称・親子） | **人事管理** | 人事管理 → ポータル（`organizations`） |
| 管理者（承認者） | **人事管理** | 人事管理 → ポータル（`managerLoginId` → `approver_user_id`） |
| アカウントの存在（社員番号） | **人事管理** | 人事管理 → ポータル（`createMissing`。パスワード未設定で発行） |
| パスワード・アプリ権限（role / can_manage / 部署の apps 割当） | **ポータル** | 連携しない（ポータルが保持） |
| 組織の階層（本部→工場/部→職場）・組織の長 | **人事管理** | 人事管理が保持（ポータルは部署→職場の2階層に潰して受ける） |

人事管理が「人と組織」のマスター。ただし**パスワードと権限は送らない**ので、
ポータル側の権限運用は壊れない。

### 組織の突合（重要）

ポータルの部署コード（`D001` 等）は既存の運用で使われているため**変えない**。
人事管理側のコード（部署コード・職場コード）は `hr_code` 列で別に持ち、突合キーにする。

1. `hr_code` が一致する行があればそれ
2. 無ければ**名称が一致**する既存の部署・職場（ポータルの `code`・`apps` はそのまま、
   `hr_code` だけを結び付ける＝**既存のアプリ割当を壊さない**）
3. それも無ければ新規作成（`apps` は空。どのアプリを使うかはポータルで設定する）

## リクエスト

```http
POST /api/hr-sync
Content-Type: application/json

{
  "key": "<PF_PROVISION_KEY>",
  "createMissing": true,
  "organizations": [
    { "kind": "dept", "code": "12121102", "name": "大口工場",
      "departmentCode": null, "isFactory": true, "sort": 1 },
    { "kind": "workplace", "code": "12124001", "name": "大口工場 ﾌﾟﾚｽ1",
      "departmentCode": "12121102", "isFactory": false, "sort": 2 }
  ],
  "employees": [
    {
      "loginId": "E200",
      "name": "製造 一郎",
      "departmentCode": "D001",
      "workplaceCode": "W001",
      "positionName": "主任",
      "dutyName": "生産計画",
      "birthDate": "1990-02-15",
      "hireDate": "2013-04-01",
      "employmentType": "正社員",
      "status": "active",
      "retireDate": null,
      "email": "ichiro@example.com",
      "managerLoginId": "E100"
    }
  ]
}
```

`status` は `active`（在籍）/ `leave`（休職）/ `loaned`（出向）/ `retired`（退職）。

## レスポンス

```json
{
  "results": [
    { "loginId": "E200", "status": "updated", "reprovisioned": true, "approverSet": true },
    { "loginId": "E201", "status": "created", "reprovisioned": true },
    { "loginId": "E999", "status": "error", "message": "部署コード D999 が見つかりません" }
  ],
  "organizations": { "created": 206, "linked": 3, "updated": 0, "errors": [] }
}
```

| `status` | 意味 |
|---|---|
| `created` | アカウントを発行した（`createMissing` 指定時。パスワード未設定・権限は一般） |
| `updated` | ポータル側の人事項目を更新した |
| `skipped` | 何もしなかった（未登録かつ `createMissing` なし／退職者／所属が決まらない） |
| `error` | 部署コード不一致など、その社員だけ失敗 |

`organizations` は組織の連携結果。`created`＝新規作成、`linked`＝同名の既存へ紐づけ、
`updated`＝名称・所属部署の更新。

`reprovisioned` は「所属が変わったので各アプリへ再連携した」ことを示す。
**所属が変わっていなくても役職や人事項目は更新される**ので、`updated` と
`reprovisioned` は分けて返す（「所属は同じだが役職だけ変わった」を
「変更なし」と表示すると実態と食い違うため）。

## 設計の要点

1. **アカウントの発行は `createMissing` を指定したときだけ** — 指定すると、社員台帳に
   居てポータルに未登録の社員を**パスワード未設定（招待状態）・権限は一般**で作る。
   本人がポータルでパスワードを設定すれば使える。退職者と所属が決まらない社員は作らない。
   指定しなければ従来どおり既存ユーザーの更新だけ（`skipped`）。
2. **所属が変わったときだけ再連携する** — `provisionUsers()` は各アプリへHTTPを撒くため、
   毎回呼ぶと重い。部署・職場が実際に変わった人だけを対象にする。
3. **退職者はアプリ利用を止める** — `status='retired'` を受けたら部署を外し、
   アプリへの再連携対象から除く（既存アカウントの扱いはポータルの運用に合わせる）。
4. **認証は `PF_PROVISION_KEY`** — 既存のプロビジョニングと同じ共有鍵。
   タイミング安全に比較する。
5. **再連携の役割はポータルの現在値から組み立てる** — 人事管理は `role` を送ってこない。
   補わないと既定の `member` に落ちてアプリ側の権限運用が壊れる
   （`api/users-refresh.js` と同じ組み立て方をしている）。
   承認者は人事管理が正なので `managerLoginId` を優先し、無いときだけ
   ポータルの規則（本人指定 → 職場の管理者 → 職場所属の管理者）で補う。
6. **承認者は全員の行が揃ってから設定する** — 承認者本人が同じ連携で作られることが
   あるため、社員の登録・更新を一巡してからまとめて解決する。

## 実装

実物は `pf-portal/api/hr-sync.js`（`claude/hr-master-app-dev-hvif4t` ブランチ）。
ここに写しを置くと本体と乖離するため、**実装はそのファイルを見ること**。

処理の順序だけ記しておく。

1. `organizations` を部署 → 職場の順に突合（`hr_code` → 名称 → 新規作成）
2. 社員を1人ずつ処理。未登録は `createMissing` のときだけ発行、既存は人事項目と所属を更新
3. 全員ぶんの行が揃ってから `managerLoginId` を `approver_user_id` へ解決
4. 所属が変わった在籍者だけ `provisionUsers()` で各アプリへ再連携

## 検証

`pf-jinji` の実データ（209組織・1,685名）を実DBへ流し、次を確認している。

- 組織: 新規206件・既存へ紐づけ3件・エラー0。既存部署（D001 等）の `code` と `apps` は不変
- 社員: 1,685名を発行・承認者1,098名を設定・エラー0（約3.4秒）
- 2回目は新規0件で人数据え置き（冪等）
- ポータルの `role` / `can_manage` は連携で変わらない

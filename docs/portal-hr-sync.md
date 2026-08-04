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
| ログインID・パスワード・アプリ権限（role / can_manage / apps）・承認者 | **ポータル** | 連携しない（ポータルが保持） |
| 部署・職場そのものの存在（コード・名称） | **ポータル** | ポータル → 人事管理（実装済み `/api/departments`・`/api/workplaces`） |
| 組織の階層（本部→部→課→係）・組織の長 | **人事管理** | 連携しない（人事管理が保持） |

この分担により、人事管理は**パスワードも権限も送らない**。ポータル側の権限運用は壊れない。

## リクエスト

```http
POST /api/hr-sync
Content-Type: application/json

{
  "key": "<PF_PROVISION_KEY>",
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
      "email": "ichiro@example.com"
    }
  ]
}
```

`status` は `active`（在籍）/ `leave`（休職）/ `loaned`（出向）/ `retired`（退職）。

## レスポンス

```json
{
  "results": [
    { "loginId": "E200", "status": "updated", "reprovisioned": true },
    { "loginId": "E999", "status": "error", "message": "部署コード D999 が見つかりません" }
  ]
}
```

| `status` | 意味 |
|---|---|
| `updated` | ポータル側の人事項目を更新した |
| `skipped` | 何もしなかった（ポータルに未登録の社員番号） |
| `error` | 部署コード不一致など、その社員だけ失敗 |

`reprovisioned` は「所属が変わったので各アプリへ再連携した」ことを示す。
**所属が変わっていなくても役職や人事項目は更新される**ので、`updated` と
`reprovisioned` は分けて返す（「所属は同じだが役職だけ変わった」を
「変更なし」と表示すると実態と食い違うため）。

## 設計の要点

1. **アカウントを勝手に作らない** — 既定では既存ユーザーの人事項目を更新するだけ。
   ポータルに居ない社員番号は `skipped` として返す。アカウント発行はポータル側の
   運用（管理画面・CSV一括登録）に任せる。
   新規入社を人事管理から自動発行したい場合は、リクエストに `createMissing: true` を
   足す拡張を後から入れられるようにしてある。
2. **所属が変わったときだけ再連携する** — `provisionUsers()` は各アプリへHTTPを撒くため、
   毎回呼ぶと重い。部署・職場が実際に変わった人だけを対象にする。
3. **退職者はアプリ利用を止める** — `status='retired'` を受けたら部署を外し、
   アプリへの再連携対象から除く（既存アカウントの扱いはポータルの運用に合わせる）。
4. **認証は `PF_PROVISION_KEY`** — 既存のプロビジョニングと同じ共有鍵。
   タイミング安全に比較する。
5. **再連携の役割・承認者はポータルの現在値から組み立てる** — 人事管理はこれらを
   送ってこない。`provisionUsers()` へ渡すときに補わないと、`role` が既定の
   `member` に落ち、承認者も消えてアプリ側の権限運用が壊れる
   （`api/users-refresh.js` と同じ組み立て方をしている）。

## 参照実装（`pf-portal/api/hr-sync.js`）

```js
// PF人事管理（pf-jinji）からの人事情報連携の受け口。
//
// 人事管理が「人」のマスターで、ここへ所属・役職・人事プロフィールが送られてくる。
// パスワード・アプリ権限（role / can_manage / apps 割当）・承認者は送られてこないし、
// このAPIでも一切変更しない（それらはポータルが持つ情報のため）。
//
// 所属が変わった在籍者だけ、既存の provisionUsers() で各業務アプリへ再連携する。
// これにより「人事管理で発令 → 各アプリの部署・権限が追従」が成立する。
const crypto = require("crypto");
const { requireSql, ensureSchema, readBody } = require("../lib/db");
const { provisionUsers } = require("../lib/provision");

const MAX_EMPLOYEES = 500;
const LOGIN_ID_RE = /^[A-Za-z0-9_@.-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** タイミング安全な鍵比較（長さ違いは即 false）。 */
function safeKeyEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const nz = (v) => {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
};
const nzDate = (v) => {
  const s = nz(v);
  return s && DATE_RE.test(s) ? s : null;
};

// 承認者の解決: 本人の承認者指定 → 職場の管理者（指定） → 職場所属の管理者（社員番号順で最初）
// （api/users.js・api/users-refresh.js と同じ規則。管理者は明示指定のみ）。
async function resolveApproverLoginId(sql, approverUserId, workplaceId, role) {
  if (approverUserId) {
    const rows = await sql`SELECT login_id FROM pf_portal_users WHERE id = ${approverUserId} LIMIT 1`;
    if (rows.length > 0) return rows[0].login_id;
  }
  if (role === "admin") return null;
  if (workplaceId) {
    const rows = await sql`
      SELECT a.login_id
      FROM pf_portal_workplaces w
      JOIN pf_portal_users a ON a.id = w.admin_user_id
      WHERE w.id = ${workplaceId}
      LIMIT 1`;
    if (rows.length > 0) return rows[0].login_id;
    const fallback = await sql`
      SELECT login_id FROM pf_portal_users
      WHERE workplace_id = ${workplaceId} AND role = 'admin'
      ORDER BY login_id
      LIMIT 1`;
    if (fallback.length > 0) return fallback[0].login_id;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }
  const provisionKey = (process.env.PF_PROVISION_KEY || "").trim();
  if (!provisionKey) {
    res.status(503).json({ message: "サーバー設定が未完了です（PF_PROVISION_KEY）" });
    return;
  }

  const body = readBody(req);
  if (!safeKeyEqual(String(body.key || ""), provisionKey)) {
    res.status(401).json({ message: "認証に失敗しました" });
    return;
  }

  const employees = body.employees;
  if (!Array.isArray(employees) || employees.length === 0) {
    res.status(400).json({ message: "employees を指定してください" });
    return;
  }
  if (employees.length > MAX_EMPLOYEES) {
    res.status(400).json({ message: `一度に送れるのは最大${MAX_EMPLOYEES}件です` });
    return;
  }

  const sql = requireSql(res);
  if (!sql) return;

  try {
    await ensureSchema(sql);

    // 部署・職場コード → 行 の対応表
    const depts = await sql`SELECT id, code, name, kind, apps FROM pf_portal_departments`;
    const deptByCode = new Map(depts.map((d) => [d.code, d]));
    const deptById = new Map(depts.map((d) => [d.id, d]));
    const wps = await sql`SELECT id, code, department_id FROM pf_portal_workplaces`;
    const wpByCode = new Map(wps.map((w) => [w.code, w]));

    const results = [];
    // 所属が実際に変わった人だけ再連携する（provisionUsers は各アプリへHTTPを撒くため）
    const needsReprovision = [];

    for (const e of employees) {
      const loginId = (e?.loginId ?? "").toString().trim();
      try {
        if (!LOGIN_ID_RE.test(loginId)) {
          results.push({ loginId, status: "error", message: "社員番号の形式が不正です" });
          continue;
        }

        const cur = await sql`
          SELECT id, login_id, name, email, role, department_id, workplace_id, approver_user_id
          FROM pf_portal_users WHERE login_id = ${loginId} LIMIT 1`;
        if (cur.length === 0) {
          // ポータルに居ない社員番号。アカウント発行はポータル側の運用に任せる。
          results.push({ loginId, status: "skipped", message: "ポータルに未登録" });
          continue;
        }
        const u = cur[0];

        const status = ["active", "leave", "loaned", "retired"].includes(e.status) ? e.status : "active";
        const retired = status === "retired";

        // 部署・職場の解決。退職者は所属を外す。
        let deptId = u.department_id;
        let wpId = u.workplace_id;
        if (retired) {
          deptId = null;
          wpId = null;
        } else {
          const deptCode = nz(e.departmentCode);
          if (deptCode) {
            const d = deptByCode.get(deptCode);
            if (!d) {
              results.push({ loginId, status: "error", message: `部署コード ${deptCode} が見つかりません` });
              continue;
            }
            deptId = d.id;
          }
          const wpCode = nz(e.workplaceCode);
          if (wpCode) {
            const w = wpByCode.get(wpCode);
            if (!w) {
              results.push({ loginId, status: "error", message: `職場コード ${wpCode} が見つかりません` });
              continue;
            }
            if (deptId && w.department_id !== deptId) {
              results.push({
                loginId,
                status: "error",
                message: `職場 ${wpCode} は指定の部署の配下ではありません`,
              });
              continue;
            }
            wpId = w.id;
          } else if (deptCode) {
            // 部署だけ指定された＝職場は未所属にする
            wpId = null;
          }
        }

        const affiliationChanged = deptId !== u.department_id || wpId !== u.workplace_id;

        // 人事項目と所属だけを更新する。role・can_manage・password_hash・
        // approver_user_id には触れない（ポータルが持つ情報のため）。
        await sql`
          UPDATE pf_portal_users SET
            name            = COALESCE(${nz(e.name)}, name),
            department_id   = ${deptId},
            workplace_id    = ${wpId},
            position_name   = ${nz(e.positionName)},
            duty_name       = ${nz(e.dutyName)},
            birth_date      = ${nzDate(e.birthDate)},
            hire_date       = ${nzDate(e.hireDate)},
            employment_type = ${nz(e.employmentType)},
            email           = COALESCE(${nz(e.email)}, email)
          WHERE id = ${u.id}`;

        // 所属が変わった在籍者だけ、各アプリへ再連携する。
        // 役割・承認者・工場名はポータルの現在値から組み立てる（人事管理からは
        // 送られてこないため、ここで補わないとアプリ側の権限が既定値に戻ってしまう）。
        let reprovisioned = false;
        if (affiliationChanged && !retired && deptId) {
          const d = deptById.get(deptId);
          const role = u.role === "admin" ? "admin" : "member";
          let approverLoginId = await resolveApproverLoginId(sql, u.approver_user_id, wpId, role);
          if (approverLoginId === u.login_id) approverLoginId = null;
          needsReprovision.push({
            id: u.id,
            loginId,
            name: nz(e.name) || u.name,
            email: nz(e.email) || u.email,
            apps: Array.isArray(d?.apps) ? d.apps : [],
            factory: d && d.kind === "factory" ? d.name : null,
            role,
            approverLoginId,
          });
          reprovisioned = true;
        }

        // 行は必ず更新している。所属が変わったかは reprovisioned で別に伝える
        // （所属据え置きで役職だけ変わった場合を「変更なし」と呼ぶと実態と食い違う）
        results.push({ loginId, status: "updated", reprovisioned });
      } catch (err) {
        results.push({ loginId, status: "error", message: err.message });
      }
    }

    if (needsReprovision.length > 0) {
      // 失敗しても連携全体は成功として返す（アプリ側の一時障害で人事情報の更新まで
      // 巻き戻すと、次に送り直すまでポータルが古いままになるため）
      try {
        await provisionUsers(sql, needsReprovision);
      } catch (err) {
        console.warn("[hr-sync] reprovision failed:", err.message);
      }
    }

    res.status(200).json({ results });
  } catch (e) {
    console.error("[hr-sync]", e);
    res.status(500).json({ message: "サーバーエラーが発生しました" });
  }
};
```

## ポータル側の他の変更（既存の依頼分）

`jinji` をポータルのアプリとして登録するための変更は README にまとめてある。
本連携だけなら `api/hr-sync.js` の追加だけで動く（`jinji` のタイル登録とは独立）。

なお Vercel Hobby の「1デプロイ12関数まで」制限があるため、関数数が上限に近い場合は
既存の `api/user.js` のように**別APIへ統合**する形でもよい
（例: `api/provision-in.js` にまとめる）。その場合は人事管理側の
`src/lib/portalPush.ts` の URL も合わせて変更する。

## 動作確認

ポータルへ入れたあと、人事管理の **設定 → ポータル連携** から

1. 「連携内容を確認」で送信内容を点検（部署コードが「未解決」の社員がいないか）
2. 「ポータルへ連携」で実行
3. ポータルの管理画面でユーザーの所属・役職が更新されていることを確認

異動申請の発令時にも、その社員だけ自動で連携される。

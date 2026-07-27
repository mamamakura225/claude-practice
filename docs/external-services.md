# 外部サービス / インフラ一覧

このリポジトリが依存する外部サービスと、その設定・有効化方法をまとめる。
新しく参加した開発者がまずここを見れば全体像が分かることを目的とする。

最終更新: 2026-05-26

---

## 1. アカウントを持って使うサービス

| サービス | 役割 | プラン | 接続先 / 識別子 | 設定場所 |
|---|---|---|---|---|
| **Firebase (Firestore)** | データ保存（タスク・練習記録） | 無料(Spark)想定 | プロジェクト `dtask-d08b6` / `firestore.googleapis.com` | `firebase-config.js`（gen-config が生成） |
| **Vercel** | ホスティング / デプロイ | 無料(Hobby) | 本番 `claude-practice-hazel.vercel.app` | GitHub Actions Secrets の `VERCEL_*` |
| **GitHub** | ソース管理 + CI(Actions) | 無料(個人) | `github.com/mamamakura225/claude-practice` | `.github/workflows/test.yml` |
| **Sentry** | エラー監視（本番JSエラー収集） | 無料(~5,000 errors/月) | `ingest.us.sentry.io`（US） | Secret `SENTRY_DSN` → `monitoring-config.js` |
| **PostHog** | 利用計測（操作の種類と頻度） | 無料(大きめ枠) | `us.i.posthog.com`（US） | Secret `POSTHOG_KEY` (+任意 `POSTHOG_HOST`) → `monitoring-config.js` |

> 無料枠の数値は目安（各社規約で変動）。現状の利用規模ではいずれも無料の範囲。

### Firestore のデータ構造
- dtask: collection `dtask` / doc `data`
- piano-pet: collection `pianopet` / doc は「がぞくコード」（`pp-<uuid>`・#233 段階1）。未移行の端末は旧固定ID（`data` / `test`）のまま動くため、当面は双方が存在する（同一プロジェクトを共有）
- 認証なし。アクセス制御は Firestore セキュリティルールで実施（`list` / `delete` を拒否し、doc ID を知らない第三者の到達と全消しを防ぐ）。
- **ルールの正本は [`firestore.rules`](../firestore.rules)（版管理）**。反映は `firebase deploy --only firestore:rules`（プロジェクト既定は `.firebaserc`）。コンソールで手編集した場合は必ず本ファイルへ反映し、本番と一致させる。
- 現状の機密性は「がぞくコードを知っているか」に依存する（capability 方式）。認証によるアクセス制御は段階2（#258）で対応。

---

## 2. アカウント不要（実行時に読み込むだけ / CDN・フォント）

ログインも課金もなし。ブラウザ実行時に部品を取得する先。

| 配信元 | 読み込むもの |
|---|---|
| `www.gstatic.com` (Google) | Firebase SDK 本体 |
| `cdn.jsdelivr.net` (jsDelivr) | Sentry SDK / PostHog SDK（**鍵がある時だけ**動的 import） |
| `fonts.googleapis.com` (Google Fonts) | Web フォント |

---

## 3. CI でのみ使うもの（GitHub Actions）

| 名前 | 役割 |
|---|---|
| `treosh/lighthouse-ci-action@v12` | Lighthouse 採点（性能・a11y・SEO。warn 基準で非ブロック） |
| `actions/checkout` / `actions/setup-node` / `actions/upload-artifact` | GitHub 公式の定番 Action |
| Lighthouse (Google 製) | 上記 Action 内で動作。アカウント不要 |

---

## 4. 設定の注入の仕組み（重要）

ビルド工程のない静的アプリのため、接続情報・キーは
**`scripts/gen-firebase-config.mjs`（`npm run gen-config`）が環境変数から生成**する。

- 生成物:
  - `apps/dtask/firebase-config.js` / `apps/piano-pet/js/firebase-config.js`（`firebaseConfig`）
  - `apps/dtask/monitoring-config.js` / `apps/piano-pet/js/monitoring-config.js`（`monitoringConfig`）
- 参照する環境変数: `FIREBASE_*` / `SENTRY_DSN` / `POSTHOG_KEY` / `POSTHOG_HOST`
- env 未設定時のフォールバック: Firebase=現行本番値 / 監視系=空（= **no-op で無効**）
- CI の `gen-config:check` が生成物のドリフトを検知（手編集禁止。変えたら `npm run gen-config`）
- デプロイ時（`.github/workflows/test.yml` の deploy ジョブ）に Secrets を流し込んでから `vercel build`

### Secret の置き場所
GitHub リポジトリの **Actions Secrets**（Vercel 側ではない）。確認: `gh secret list`

| Secret 名 | 用途 | 未登録時 |
|---|---|---|
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | Vercel デプロイ | デプロイ不可 |
| `SENTRY_DSN` | Sentry 有効化 | Sentry 無効(no-op) |
| `POSTHOG_KEY` / `POSTHOG_HOST` | PostHog 有効化 | PostHog 無効(no-op) |
| `FIREBASE_*`(6種) | Firebase 接続の上書き | 現行本番値にフォールバック |

---

## 5. 外部サービスの有効化 / 鍵差し替え手順

1. 各サービスのダッシュボードで鍵を取得（Sentry=DSN / PostHog=Project API Key 等）
2. Secret を登録: `gh secret set <NAME>`（値はプロンプトに貼り付け）
3. 反映: 次回 `main` への push で自動。即時にしたい場合は最新の本番デプロイ run を再実行
   ```bash
   gh run rerun <run-id>   # gh run list --branch main で run-id を確認
   ```
4. 確認: 本番の生成物に値が載っているか
   ```bash
   curl -s https://claude-practice-hazel.vercel.app/dtask/monitoring-config.js
   ```

---

## 6. プライバシー方針（監視・計測）

- **送らないもの**: タスク名・詳細・曲名などの「内容」、および個人情報。
- **Sentry**: breadcrumb を全破棄・`request`/`user` を除去・session replay 不使用。送るのは例外とスタックトレースのみ。非minified 配信なのでソースマップ不要。
- **PostHog**: autocapture / pageview / session-recording を無効化・DNT 尊重。送るのは操作の種類と頻度のみ（`view_changed` / `task_added` / `practice_recorded`）。`track()` の props に内容を入れないこと。

---

## 7. 障害時の挙動

- Sentry / PostHog の SDK は**動的 import** で読み込み、失敗してもアプリ本体は巻き込まない（監視・計測だけが静かに無効化される）。
- Firebase は取得失敗時 localStorage のみで動作（オフライン耐性）。

---

## 8. 未使用だが検討中（バックログ）

実装されておらず**現在は使っていない**外部 API 候補:
- YouTube Data API（[#67](https://github.com/mamamakura225/claude-practice/issues/67) 練習曲の動画検索）
- Open-Meteo API（[#68](https://github.com/mamamakura225/claude-practice/issues/68) 天気連動ボーナス）

関連インフラ Issue: [#103](https://github.com/mamamakura225/claude-practice/issues/103) Firebase ステージング/本番分離。

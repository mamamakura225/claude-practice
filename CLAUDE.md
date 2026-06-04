# CLAUDE.md

自作アプリのモノレポ。概要・アプリ一覧・URLは [README.md](./README.md) を参照。ここでは作業時に踏みやすい落とし穴と規約をまとめる。

## 構成
- `apps/dtask/` — タスク管理SPA（Vanilla JS + Firebase）。docs: [requirements.md](./apps/dtask/docs/requirements.md)（要件定義書）/ [architecture.md](./apps/dtask/docs/architecture.md) / [data-model.md](./apps/dtask/docs/data-model.md) / [features.md](./apps/dtask/docs/features.md) / [testing.md](./apps/dtask/docs/testing.md)
- `apps/piano-pet/` — ピアノ練習PWA（猫育成）。docs: [requirements.md](./apps/piano-pet/docs/requirements.md)（要件定義書）/ [features.md](./apps/piano-pet/docs/features.md)（機能詳細）/ [data-model.md](./apps/piano-pet/docs/data-model.md)（設計書）
- 共有ツール（npm / vitest / playwright / vercel / CI）はリポジトリルートに1セット。

## ドキュメント更新ルール（最重要）
**ソース（`apps/*/`）を変更したら、同じPR内で要件定義書と設計書へ必ず反映する。** 実装とドキュメントの乖離を残さない。
- **要件定義書**: 各アプリの `docs/requirements.md`。機能・画面・データ・報酬ロジック・スコープなど「何を作るか」を変えたら更新。
- **設計・機能書**: dtask は `docs/features.md` / `architecture.md` / `data-model.md` / `testing.md`、piano-pet は `docs/features.md` / `data-model.md`。画面仕様・報酬ロジック・アーキテクチャ・スキーマ・同期方式・テスト方針など「どう作るか／詳細」を変えたら更新。
- 判断基準：「次にこのコードを読む人が、ドキュメントだけ見て古い前提を信じてしまうか？」がYESなら更新対象。フィールド追加・画面追加・報酬式変更・設定方式変更などは原則すべて該当。
- 設計判断の理由が非自明なら、該当docの `## 設計判断` / `> **設計判断**:` に残す。

## コマンド
```bash
npm test            # Vitest 単体テスト（apps/dtask/tests 対象）
npm run test:e2e    # Playwright E2E（http-server 自動起動）
npm run gen-sw      # piano-pet の SW キャッシュ版を再生成
npm run gen-sw:check # 版ずれ検知（CIで実行、差分があれば失敗）
```

## gen-sw（最重要の落とし穴）
piano-pet のみ対象。`apps/piano-pet/` のアセット（`index.html`/`css`/`js`/`manifest.json`/`icons`）を変更したら **必ず `npm run gen-sw` を実行してコミット**する。`scripts/gen-sw.mjs` がアセット内容のハッシュから `sw.js` の `CACHE`/`APP_SHELL` と `index.html` の `?v=` を同期する。CIの `gen-sw:check` がドリフトを検知して落とす。

並行PRはこの `sw.js`/`index.html` の `?v=` でほぼ確実に衝突する。**スタックPR（base同士の依存）は禁止**、独立ブランチを切り、main取り込みのたびに `gen-sw` を再生成すること。

## Firebase
piano-pet は dtask の Firebase プロジェクト `dtask-d08b6` を共有する（`pianopet` collection に保存）。認証なし・`cloud.js` は動的importでロード（PWAのオフライン動作を壊さないため）。Firestoreルールは pianopet を許可済み。

config は `firebase-config.js`（`apps/dtask/` と `apps/piano-pet/js/`）に集約し、`scripts/gen-firebase-config.mjs` が `FIREBASE_*` env から生成する（env未設定時は本番値にフォールバック）。同スクリプトは監視用 `monitoring-config.js`（`SENTRY_DSN`、未設定時は空＝Sentry無効）も生成する。値を変えたら `npm run gen-config` を実行してコミット。CIの `gen-config:check` がドリフトを検知。クライアント用 Firebase 設定や DSN は元々公開情報なので秘匿目的ではなく、環境分離（将来のステージング）の継ぎ目が目的。デプロイ時に env を流し込む。

## エラー監視 / 利用計測 (Sentry / PostHog)
`monitoring-config.js`（gen-config が生成）の `sentryDsn` / `posthogKey` が空なら各 SDK は **no-op**（CDN import もしない）。
- `sentry.js`: DSN があれば CDN から SDK を動的 import して init。breadcrumb は全破棄・`request`/`user` は送らない（タスク内容やPIIを送信しない）。非minified配信なのでソースマップ不要。
- `analytics.js`: PostHog。autocapture/pageview/session-recording を無効化し DNT 尊重。送るのは操作種別と頻度のみ（`view_changed`・`task_added`・`practice_recorded` 等）で、タスク名や曲名などの**内容は送らない**。`track(event, props)` の props に内容を入れないこと。

## CI / デプロイ
[.github/workflows/test.yml](./.github/workflows/test.yml): 全branch pushで unit + e2e、`gen-sw:check` / `gen-config:check` / `perf-budget:check`（piano-pet のアセット gzip サイズ予算・#147）を実行。`main` への push 通過後に Vercel 本番デプロイ、PR(main宛)はプレビューデプロイ（dependabot のPRはSecretsが渡らず失敗するため除外）。Node は CI上 20。予算超過時は `scripts/perf-budget.mjs` の `BUDGETS_KIB` を見直す。

## ブランチ運用 / バックログ
- feature branch を切って PR。`sw.js`/`index.html` を触る場合は gen-sw 再生成を忘れない。
- **PR本文に `Closes #NNN` を書いて Issue をマージ連動クローズする**（複数Issueは各行に `Closes #NNN`）。コミット件名の `(#NNN)` は参照のみで自動クローズされない（`Closes`/`Fixes`/`Resolves` キーワードが必要）。squash マージでも本文のキーワードで連動する。
- バックログは [GitHub Issues](https://github.com/mamamakura225/claude-practice/issues) に一本化。ラベル `app/*`・`type/*`（infra/ux/tech-debt 等）・優先度 `P1`〜`P3`。

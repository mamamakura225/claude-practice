# CLAUDE.md — エージェント行動契約 & 開発規約

自作アプリのモノレポ。アプリ概要・URLは [README.md](./README.md) を参照。
本ファイルは、AIエージェントのコンテキスト汚染を防ぎ、無限デバッグループや破壊的変更を抑止するための不変の指示書である。
エージェント共通の応答ガイドライン・思考/コーディング規約（Karpathy規範）は端末のグローバル規約（`~/.claude/CLAUDE.md`）に一本化しており、本書は**プロジェクト固有規約のみ**を定める。

## 1. プロジェクト構成 & 階層的開示 (Progressive Disclosure)
エージェントはタスクに応じて各アプリの `docs/` 内にある詳細ドキュメント（要件定義書・設計書等）を自律的に読み込み、コンテキストの肥大化を防ぐこと。
- `apps/dtask/` — タスク管理SPA（Vanilla JS + Firebase）。
- `apps/piano-pet/` — ピアノ練習PWA（猫育成）。
  ※注意：piano-pet は dtask の Firebase プロジェクト（`dtask-d08b6`）を共有（間借り）する設計になっている。

## 2. 主要実行コマンド

```bash
npm test              # Vitest単体テスト (apps/dtask/tests対象)
npm run test:e2e      # Playwright E2E (自動サーバー起動)
npm run gen-sw        # piano-pet: SWキャッシュ・index.htmlの?v=を再生成
npm run gen-config    # envからFirebase/Sentry等の各種configをマッピング生成
```

## 3. プロジェクト固有の落とし穴 & 鉄則 (Critical Guardrails)

### ① PWAキャッシュ同期とブランチ規約 (`npm run gen-sw`)
- `apps/piano-pet/` のアセット（html/css/js/manifest等）を変更した場合、必ず `npm run gen-sw` を実行して自動生成・コミットせよ（手動修正は厳禁）。CIの `gen-sw:check` でドリフトを検知する。
- 並行PRでの衝突を防ぐため、**スタックPR（依存関係のあるPR）は禁止**。独立ブランチを切り、main取り込みのたびに再生成すること。

### ② 設定ファイルの自動生成 (`npm run gen-config`)
- `firebase-config.js` や `monitoring-config.js` を直接書き換えてはならない。設定変更時は環境変数を修正の上、必ず `npm run gen-config` を用いて再生成せよ。

### ③ プライバシー・利用計測規約 (最重要)
- SentryおよびPostHogの実装において、**ユーザーのタスク内容、曲名、PII（個人情報）は絶対に送信してはならない**。
- `sentry.js`: breadcrumbは全破棄し、`request`/`user` は送信しない。
- `analytics.js`: autocapture/session-recording等は無効化。送るのは操作種別（`task_added`等）のフラグのみとし、`track(event, props)` の props に具体的なテキスト内容を入れないこと。

### ④ パフォーマンス予算 (`perf-budget`)
- `perf-budget:check`（Gzipサイズ制限）でエラーが出た場合、無理にコードを圧縮して可読性を破壊してはならない。最小構成を徹底しても予算を超える場合は、`scripts/perf-budget.mjs` の `BUDGETS_KIB` を見直すよう人間に提案せよ。

### ⑤ ドキュメントの完全同期
- ソース（`apps/*/`）を変更した場合、必ず同一PR内で関連する要件定義書（`requirements.md`）および設計書（`features.md` 等）に変更を反映せよ。非自明な設計判断の理由は、該当docの `## 設計判断` または `> **設計判断**:` に必ず残すこと。

### ⑥ Issue・PR連動
- PR作成時、本文に必ず `Closes #NNN` を記述してIssueを連動クローズさせよ。コミット件名の `(#NNN)` は自動クローズ対象外のため不可。

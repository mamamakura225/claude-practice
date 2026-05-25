# CLAUDE.md

自作アプリのモノレポ。概要・アプリ一覧・URLは [README.md](./README.md) を参照。ここでは作業時に踏みやすい落とし穴と規約をまとめる。

## 構成
- `apps/dtask/` — タスク管理SPA（Vanilla JS + Firebase）。docs: [architecture.md](./apps/dtask/docs/architecture.md) / [data-model.md](./apps/dtask/docs/data-model.md) / [testing.md](./apps/dtask/docs/testing.md)
- `apps/piano-pet/` — ピアノ練習PWA（猫育成）。docs: [requirements.md](./apps/piano-pet/docs/requirements.md) / [data-model.md](./apps/piano-pet/docs/data-model.md)
- 共有ツール（npm / vitest / playwright / vercel / CI）はリポジトリルートに1セット。

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

config は `firebase-config.js`（`apps/dtask/` と `apps/piano-pet/js/`）に集約し、`scripts/gen-firebase-config.mjs` が `FIREBASE_*` env から生成する（env未設定時は本番値にフォールバック）。値を変えたら `npm run gen-config` を実行してコミット。CIの `gen-config:check` がドリフトを検知。クライアント用 Firebase 設定は元々公開情報なので秘匿目的ではなく、環境分離（将来のステージング）の継ぎ目が目的。デプロイ時に env を流し込む。

## CI / デプロイ
[.github/workflows/test.yml](./.github/workflows/test.yml): 全branch pushで unit + e2e、`gen-sw:check` を実行。`main` への push 通過後に Vercel 本番デプロイ、PR(main宛)はプレビューデプロイ（dependabot のPRはSecretsが渡らず失敗するため除外）。Node は CI上 20。

## ブランチ運用 / バックログ
- feature branch を切って PR。`sw.js`/`index.html` を触る場合は gen-sw 再生成を忘れない。
- バックログは [GitHub Issues](https://github.com/mamamakura225/claude-practice/issues) に一本化。ラベル `app/*`・`type/*`（infra/ux/tech-debt 等）・優先度 `P1`〜`P3`。

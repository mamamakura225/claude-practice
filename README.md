# claude-practice

自作アプリを集めたモノレポ。各アプリは `apps/<name>/` に置き、共有ツール（npm / テスト / CI / Vercel設定）はリポジトリルートに1セット置く。

🌐 **本番**: https://claude-practice-hazel.vercel.app/ （ルートがアプリ一覧）

## アプリ

| アプリ | URL | 概要 | ソース |
|---|---|---|---|
| dタスク | [/dtask/](https://claude-practice-hazel.vercel.app/dtask/) | タスク管理SPA（Vanilla JS + Firebase） | [apps/dtask/](./apps/dtask/) |
| ピアノペット | [/piano-pet/](https://claude-practice-hazel.vercel.app/piano-pet/) | 猫を育てるピアノ練習PWA | [apps/piano-pet/](./apps/piano-pet/) |

各アプリの詳細は各 `apps/<name>/README.md`（または `docs/`）を参照。

## 構成

```
claude-practice/
├── index.html            # ルートのランディング（アプリ一覧）
├── apps/
│   ├── dtask/            # タスク管理アプリ + その tests/e2e/docs
│   └── piano-pet/        # ピアノ練習アプリ + その docs
├── package.json          # 共有: npm スクリプト
├── vitest.config.js      # 共有: 単体テスト（apps/dtask/tests を対象）
├── playwright.config.js  # 共有: E2E（apps/dtask を配信してテスト）
├── vercel.json           # 共有: ルーティング（/dtask・/piano-pet）
└── .github/workflows/    # 共有: テスト & デプロイ
```

## 開発

### 必要環境
- Node.js 18 以上 / npm

### セットアップ
```bash
npm install
```

### テスト
```bash
npm test           # Vitest 単体テスト
npm run test:e2e   # Playwright E2E テスト（http-serverは自動起動）
```

### 各アプリのローカル起動
```bash
npx http-server ./apps/dtask     -p 3000 -c-1   # dタスク
npx http-server ./apps/piano-pet -p 3001 -c-1   # ピアノペット
```

## デプロイ

GitHub Actions（[.github/workflows/test.yml](./.github/workflows/test.yml)）でテスト通過後に Vercel CLI でデプロイ。

- `main` への push → 本番デプロイ
- PR (mainターゲット) → プレビューデプロイ
- リポジトリ全体を静的配信し、`vercel.json` の rewrite で `/dtask`・`/piano-pet` を各アプリへ振り分ける

## 外部サービス / インフラ

依存する外部サービス（Firebase / Vercel / GitHub / Sentry / PostHog）と、その設定・有効化手順・プライバシー方針は **[docs/external-services.md](./docs/external-services.md)** に集約。

ざっくり:
- **データ**: Firebase Firestore（`dtask-d08b6`） — **ホスティング**: Vercel — **CI/ソース**: GitHub Actions
- **エラー監視**: Sentry / **利用計測**: PostHog（どちらも鍵が未設定なら no-op で無効）
- 接続情報・キーは `npm run gen-config` が環境変数から `*-config.js` を生成して注入（詳細は上記ドキュメント）

## バックログ

[GitHub Issues](https://github.com/mamamakura225/claude-practice/issues) でラベル `type/infra` / `type/ux` / `type/tech-debt` と優先度 `P1` / `P2` / `P3` で管理。

## ライセンス

個人プロジェクト（ライセンス未設定）。

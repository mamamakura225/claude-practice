# dtask

シンプルなタスク管理SPA。Vanilla JavaScript + Firebase Firestore。

🌐 **本番URL**: https://claude-practice-hazel.vercel.app

## 機能

- リスト / Kanban の2ビュー
- サブタスク（インライン展開・編集）
- カテゴリ・優先度・タグ・期限・定期タスク
- フィルタ（プリセット: 今日 / 今週 / 期限切れ）、検索（フルテキスト / `#tag`）、ソート（手動 / 期限 / 優先度 / 作成日）
- ドラッグ&ドロップ並び替え（デスクトップ）、スワイプ操作（モバイル）
- キーボードショートカット (`N` / `/` / `Esc`)
- Firestore リアルタイム同期、オフライン時はlocalStorageフォールバック
- Undo（5秒以内）、テーマ（ライト / ダーク）、文字サイズ切替

詳細は [docs/features.md](./docs/features.md) を参照。

## 開発

### 必要環境
- Node.js 18 以上
- npm

### セットアップ
```bash
npm install
```

### ローカル起動
```bash
npx http-server -p 3000 -c-1
# → http://localhost:3000 を開く
```

### テスト
```bash
npm test           # Vitest 単体テスト
npm run test:e2e   # Playwright E2E テスト（http-serverは自動起動）
```

## デプロイ

mainブランチへのマージで Vercel が自動デプロイ。手動操作は不要。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | アーキテクチャ全体像 |
| [docs/data-model.md](./docs/data-model.md) | Task / Subtask / Category のスキーマ |
| [docs/features.md](./docs/features.md) | 機能一覧・ショートカット |
| [docs/testing.md](./docs/testing.md) | テスト戦略 |

## バックログ

[GitHub Issues](https://github.com/mamamakura225/claude-practice/issues) でラベル `type/infra` / `type/ux` / `type/tech-debt` と優先度 `P1` / `P2` / `P3` で管理。

## ライセンス

個人プロジェクト（ライセンス未設定）。

# dtask

個人用のタスク管理SPA（Vanilla JS + Firebase Firestore、ビルド無し）。

🌐 本番: https://claude-practice-hazel.vercel.app/dtask/

## 開発

npm スクリプトはリポジトリルートで実行する。

```bash
npx http-server ./apps/dtask -p 3000 -c-1   # ローカル起動 → http://localhost:3000
npm test                                     # Vitest（単体）
npm run test:e2e                             # Playwright（E2E。サーバは自動起動）
```

ローカル起動は本番 Firestore（`dtask-d08b6`）に接続する。データを触らずに画面を確認するときは、DevTools のリクエストブロックで `firestore.googleapis.com` を遮断する（5秒後に端末保存のデータで起動し、未同期モードなのでクラウドへ書かない）。

本番のパス `/dtask/` は `vercel.json` の rewrite で `apps/dtask/` を指す。

## ドキュメント

| ドキュメント | 役割 |
|---|---|
| [requirements.md](./docs/requirements.md) | 何を・誰のために作るか（目的・機能要件・非機能要件・スコープ外） |
| [features.md](./docs/features.md) | ふるまい（画面・操作・ショートカット・同期表示・アクセシビリティ）と、その設計判断 |
| [architecture.md](./docs/architecture.md) | 構造と方式（状態管理・同期・日付・設定・デプロイ）と、その設計判断 |
| [data-model.md](./docs/data-model.md) | 型（Task / Subtask / Category / Recurrence / Filters）と保存先・キー |
| [testing.md](./docs/testing.md) | テスト戦略・カバレッジ・CI |

更新ルールは [CLAUDE.md](../../CLAUDE.md) ⑤（ソース変更と同じPRで docs を更新し、非自明な判断は理由を残す）。同じ理由を2箇所に書かない。

バックログは [GitHub Issues](https://github.com/mamamakura225/claude-practice/issues)（`app/dtask`・`type/*`・`P1`〜`P3`）。

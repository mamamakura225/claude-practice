# dtask 設計ドキュメント

dtask（タスク管理SPA）の設計・仕様ドキュメント一覧。

| ドキュメント | 内容 |
|---|---|
| [requirements.md](./requirements.md) | 要件定義書（目的・ユーザー・機能要件・非機能要件・スコープ外） |
| [architecture.md](./architecture.md) | アーキテクチャ全体像、状態管理、レンダリング戦略、同期方式 |
| [data-model.md](./data-model.md) | Task / Subtask / Category のスキーマ、永続化ストレージのキー設計 |
| [features.md](./features.md) | 実装済み機能一覧、キーボードショートカット |
| [testing.md](./testing.md) | テスト戦略（Vitest 単体 / Playwright E2E / CI） |

更新ルール：`apps/dtask/` のソースを変更したら、**同じPRで要件定義書（requirements.md）と該当する設計書を必ず更新する**（[CLAUDE.md](../../../CLAUDE.md) の「ドキュメント更新ルール」）。設計判断の理由が非自明な場合は `## 設計判断` セクションに追記する。

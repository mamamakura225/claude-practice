# dtask 要件定義書

> **更新ルール**: `apps/dtask/` のソースを変更したら、本書（要件定義書）と設計書群（[architecture.md](./architecture.md) / [data-model.md](./data-model.md) / [features.md](./features.md) / [testing.md](./testing.md)）へ必ず反映する。詳細は [CLAUDE.md](../../../CLAUDE.md) の「ドキュメント更新ルール」を参照。
> 本書はコード（[app.js](../app.js) / [utils/](../utils/)）を基準に最新化している。機能の詳細仕様は [features.md](./features.md) を参照。

## 概要

個人利用を前提としたタスク管理SPA。ビルドツールを使わない Vanilla JavaScript で実装し、データは Firebase Firestore にクラウド永続化して複数デバイス間でリアルタイム同期する。

## ユーザー・利用形態

| 項目 | 内容 |
|---|---|
| 利用者 | 個人（単一ユーザー） |
| 端末 | デスクトップ / モバイル両対応（操作系を出し分け） |
| 認証 | なし（Firestore セキュリティルールでアクセス制御） |

---

## 機能要件

詳細仕様・キーボードショートカット一覧は [features.md](./features.md)。本章は要件レベルの一覧。

### ビュー
- **リストビュー**：タスクカードを縦並び表示。モバイルはスワイプ（左=削除 / 右=完了）
- **Kanban ビュー**：`todo` / `inprogress` / `done` の3列。セレクトでステータス変更
- ビュー切替トグル（選択状態は同期対象）

### タスク CRUD
- 追加：クイック追加バー（タイトルのみ即追加）／ 詳細モーダル
- 編集：カードクリックで詳細モーダル（title / description / category / priority / deadline / tags / subtasks / recurrence）
- 削除：スワイプ／詳細モーダル内ボタン
- 完了切替：カード上のチェック／スワイプ

### サブタスク
- カードに進捗バー（n/m・％）、インライン展開で一覧・追加・編集・チェック
- 展開状態は端末ローカルに永続化（クラウド非同期）

### プロジェクト（内部実体は category）
- 専用モーダルで作成・削除、カラーピッカーで色指定
- アクティブプロジェクト選択でヘッダーにバッジ表示、新規追加時に自動付与

### フィルタ・ソート
- フィルタ：プロジェクト / 優先度 / ステータス / 完了非表示 / プリセット（今日・今週・期限切れ）/ 検索（フルテキスト・`#tag`）。すべて AND
- ソート：手動（D&D）/ 作成日 / 期限 / 優先度。**完了タスクは常に末尾**

### 定期タスク（Recurrence）
- `daily` / `weekly` / `monthly`。完了時に次回タスクを自動生成、スキップ可

### 操作系
- ドラッグ&ドロップ並び替え（**デスクトップのみ**、手動ソート時）
- スワイプ操作（モバイル）
- キーボードショートカット（`N` / `/` / `?` / `Ctrl+Z` / `Esc`）
- Undo：削除等の直後トースト（5秒）、`Ctrl+Z` で60秒以内・最大5件のスタックUndo

### 表示・設定
- 同期状況インジケータ（idle / syncing / saved / error / offline）
- テーマ（ライト / ダーク）、文字サイズ（標準 / 大）。いずれも端末ローカルに永続化

---

## 非機能要件

### データ・同期
- Firestore 単一ドキュメント `dtask/data` に `tasks` / `categories` を全件格納（個人利用・小規模前提）
- 起動時ロードは**5秒タイムアウト**で localStorage フォールバック（オフライン・障害時もUI起動）
- `onSnapshot` による他デバイスからのリアルタイム反映、`window.online/offline` で自動リトライ
- スキーマ詳細・正規化（`normalizeTask`）・localStorage キーは [data-model.md](./data-model.md)

### 設定情報
- Firebase / 監視の接続情報は `firebase-config.js` / `monitoring-config.js` に集約し、`npm run gen-config` が環境変数（`FIREBASE_*` / `SENTRY_DSN` 等）から生成（未設定時は本番値／空にフォールバック）
- クライアント用 Firebase 設定や Sentry DSN は公開情報。秘匿目的ではなく環境分離（将来のステージング）が目的

### エラー監視・利用計測（任意）
- Sentry（エラー監視）／ PostHog（利用計測）。鍵が未設定なら **no-op**（SDKも読み込まない）
- PostHog は操作種別と頻度のみ送信し、**タスク名等の内容は送らない**（autocapture / pageview / session-recording 無効・DNT尊重）

### セキュリティ
- 外部入力をDOMへ挿入する箇所はすべて `escHtml`（[utils/html.js](../utils/html.js)）でエスケープ（XSS対策）

### アクセシビリティ
- ARIA（`role="dialog"` / `aria-pressed` / `aria-expanded` / `aria-label`）、キーボード巡回、補助テキストは WCAG AA（4.5:1）以上のコントラスト

### 品質保証・デプロイ
- テスト：Vitest 単体（`utils/` 純粋関数）+ Playwright E2E（代表フロー）。詳細は [testing.md](./testing.md)
- デプロイ：GitHub Actions のテスト（unit + e2e）が両方通過した場合のみ Vercel CLI でデプロイ（main=本番 / PR=プレビュー）

---

## アーキテクチャ概要

- ビルドツールなしの Vanilla JS SPA（ES Modules を直接読み込み）
- 状態は `state`（クラウド同期）と `uiState`（端末ローカル）に分離
- 命令型DOM操作・全画面再描画。イベント委譲（`data-action`）で操作分岐

> 全体像・状態管理・同期方式・レンダリング戦略・デプロイ方式は [architecture.md](./architecture.md) を参照。

---

## スコープ外（現状）

- 複数ユーザー / 認証 / 共有
- タスク件数が数百を超える規模での最適化（単一ドキュメント全件同期の再設計が必要）
- Lint / 型チェック / カバレッジ計測 / ビジュアル回帰テスト
- モーダルのフォーカストラップ、カンバンD&Dのキーボード代替操作

将来の拡張・改善は [GitHub Issues](https://github.com/mamamakura225/claude-practice/issues)（`app/dtask`・`type/*`・`P1`〜`P3`）で管理。

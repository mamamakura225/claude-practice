# dtask 要件定義書

> **更新ルール**: `apps/dtask/` のソースを変更したら、本書と設計・機能ドキュメント（[architecture.md](./architecture.md) / [data-model.md](./data-model.md) / [features.md](./features.md) / [testing.md](./testing.md)）へ必ず反映する。詳細は [CLAUDE.md](../../../CLAUDE.md) の「ドキュメント更新ルール」を参照。
> 本書は「**何を・誰のために作るか（WHAT）**」を要件レベルで記述する。機能の具体仕様（HOW/詳細）は [features.md](./features.md)、構造・設計は [architecture.md](./architecture.md) / [data-model.md](./data-model.md) に委譲する。

## 1. 概要・目的

個人利用を前提とした**タスク管理SPA**。ビルドツールを使わない Vanilla JavaScript で実装し、データは Firebase Firestore にクラウド永続化して**複数デバイス間でリアルタイム同期**する。日々のタスクを軽快に追加・整理し、どの端末からでも同じ状態で扱えることを狙う。

## 2. ターゲットユーザー・利用形態

| 項目 | 内容 |
|---|---|
| 利用者 | 個人（単一ユーザー） |
| 端末 | デスクトップ / モバイル両対応（操作系を出し分け） |
| 認証 | なし（Firestore セキュリティルールでアクセス制御） |

## 3. 機能要件

要件レベルの一覧。各機能の詳細仕様・キーボードショートカット一覧は [features.md](./features.md)。

- **ビュー**：リスト / Kanban（todo・inprogress・done）の切替表示。**起動時は「今日やること」（今日締切＋期限切れ未完了）にフォーカスし、今日分を全て完了すると達成（ご褒美）空状態を表示**(#33)。ビュー形式は前回値を復元
- **タスク管理**：追加・編集・削除・完了切替（クイック追加バー＋詳細モーダルで属性編集）
- **サブタスク**：インラインでの追加・編集・チェックと進捗表示
- **プロジェクト分類**：プロジェクト（内部category）の作成・色分け・絞り込み
- **整理**：フィルタ（プロジェクト/優先度/ステータス/プリセット＝今日・今週・期限切れ）、検索（全文・`#tag`）、ソート、ドラッグ&ドロップ並べ替え
- **定期タスク**：daily / weekly / monthly の繰り返しを完了時に自動生成（スキップ可）
- **操作補助**：キーボードショートカット、Undo（トースト＋`Ctrl+Z` のスタックUndo）
- **表示・設定**：同期状況インジケータ、テーマ（ライト/ダーク）、文字サイズ（標準/大）

## 4. 非機能要件

| 区分 | 要件 |
|---|---|
| データ・同期 | Firestore 単一ドキュメントに全件格納（個人利用・小規模前提）。`onSnapshot` で他端末の変更をリアルタイム反映。起動ロードは5秒タイムアウトで localStorage フォールバック（オフライン・障害時もUI起動）（→ [architecture.md](./architecture.md) / [data-model.md](./data-model.md)） |
| 設定情報 | Firebase / 監視の接続情報は `*-config.js` に集約し `npm run gen-config` が環境変数から生成（未設定時は本番値／空にフォールバック）。公開情報のため秘匿目的ではなく環境分離が目的 |
| 監視・プライバシー | Sentry（エラー監視）/ PostHog（利用計測）は鍵未設定なら無効（no-op）。送るのは操作種別と頻度のみで、**タスク名等の内容は送らない** |
| セキュリティ | 外部入力をDOMへ挿入する箇所はすべて `escHtml` でエスケープ（XSS対策） |
| アクセシビリティ | ARIA 付与・キーボード巡回・補助テキストは WCAG AA（4.5:1）以上のコントラスト |
| 品質保証・デプロイ | 純粋ロジックは単体テスト（Vitest）、主要フローはE2E（Playwright）で担保（→ [testing.md](./testing.md)）。CI（unit + e2e）通過時のみ Vercel デプロイ（main=本番 / PR=プレビュー） |

## 5. スコープ外（現状）

- 複数ユーザー / 認証 / 共有
- タスク件数が数百を超える規模での最適化（単一ドキュメント全件同期の再設計が必要）
- Lint / 型チェック / カバレッジ計測 / ビジュアル回帰テスト
- モーダルのフォーカストラップ、カンバンD&Dのキーボード代替操作

将来の拡張・改善は [GitHub Issues](https://github.com/mamamakura225/claude-practice/issues)（`app/dtask`・`type/*`・`P1`〜`P3`）で管理。

## 6. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [features.md](./features.md) | 機能詳細・キーボードショートカット一覧 |
| [architecture.md](./architecture.md) | アーキテクチャ全体像・状態管理・同期方式・レンダリング戦略・デプロイ |
| [data-model.md](./data-model.md) | Task / Subtask / Category のスキーマ、localStorage キー設計 |
| [testing.md](./testing.md) | テスト戦略（Vitest 単体 / Playwright E2E / CI） |
| [docs/external-services.md](../../../docs/external-services.md) | Firebase / Vercel / Sentry / PostHog の設定とプライバシー方針 |

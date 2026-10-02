# テスト

| 層 | ツール | 対象 |
|---|---|---|
| 単体 | Vitest（`npm test`） | [utils/](../utils/) の純粋関数。DOM・Firebase・localStorage は扱わない |
| E2E | Playwright（`npm run test:e2e`） | ブラウザでの主要フロー。Chromium で全件、`@compat` タグのテストだけ Firefox / WebKit でも実行 |

- 不具合を直したら、**修正前のコードで落ちる**退行テストを足す
- 既存機能のテストは、その機能を壊すと落ちることを確かめる

## 単体（[tests/](../tests/)）

| ファイル | 対象 |
|---|---|
| task.test.js | `normalizeTask`・`calculateSubtaskProgress` |
| date.test.js | 日付関数。`process.env.TZ` を実行時に切替えて時刻を固定し、ローカル日付の境界（東京 07:00・ロサンゼルス 20:00）と毎月の月末詰め・`anchorDay` を確認 |
| filter.test.js | `filterTasks`（各条件・プリセット・検索） |
| sort.test.js | `sortTasks`（各並べ替え・完了は末尾） |
| html.test.js | `escHtml` |
| color.test.js | `readableTextColor`（任意の色でライト／ダークとも 4.5:1）・`safeColor` |
| sync.test.js | `mergeFallbackChanges`（追加・編集・削除、フィールド単位、空のフォールバックでクラウドを消さない） |

## E2E（[e2e/](../e2e/)）

| ファイル | 対象 |
|---|---|
| add-task | 詳細モーダルから追加（`@compat`） |
| kanban / kanban-full-cycle | Kanban のステータス変更／列の移動（kanban-full-cycle は `@compat`） |
| filter-sort / search | 絞り込み・並べ替え・期限切れプリセット／部分一致検索 |
| subtasks / subtask-inline | モーダルでの追加／カード上の追加・チェック・編集 |
| swipe-delete | モバイルの左スワイプ削除 |
| keyboard-shortcuts / undo-shortcut | `N` `/` `Esc`、入力中の無効化／`Ctrl+Z` の復元・連続 Undo |
| card-menu | ⋮メニューの削除・並べ替え・完了・キーボード操作 |
| today-home | 起動時の今日ビュー、ビュー形式の復元、達成画面、07:00 JST の日付境界 |
| quick-add-today | 今日ビューでの追加（期限＝今日）、見えない追加の通知と［すべて表示］、トーストはフォーカス中は消えない |
| projects-settings | プロジェクトの作成・絞り込み・削除と Undo、テーマ／文字サイズの保持（`@compat`）、クイック追加チップ、Shift+Enter |
| recurrence | 各完了経路で次回分が1件、再完了で重複しない、月末、スキップ |
| offline-fallback | 未同期中は書かない、端末に残る、クラウド到着時のマージ、キャッシュ由来のスナップショットを無視、再起動をまたぐ未同期分、オフライン→復帰、自分の書込み確認では再描画しない |
| layout | 320／390px でヘッダーが収まる、色ドットの形、モバイル Kanban の列幅、ステータスバッジ |
| a11y | 表示中の全文字のコントラスト（ライト／ダーク、操作中の状態も）、タップ領域、ARIA、フォーカス復帰、同期表示（送信待ち・保存失敗の維持） |

書き方の決まり：

- Firebase への通信は遮断して localStorage で動かす（本番データを触らない）。同期の経路を確かめる spec（offline-fallback・a11y の同期表示）は、SDK を `page.route` で偽モジュールに差し替える
- 起動時は「今日」ビューなので、全件を前提にする spec は先に「すべて」へ切り替える
- 期限日を作るヘルパはアプリと同じくローカル日付で組み立てる（`toISOString()` は使わない）
- 色・サイズを測る前にアニメーション・トランジションを止める（途中の値を測らない）

E2E 未カバー：リストの D&D 並べ替え、スキップの Undo。

未導入：Lint・型チェック・カバレッジ計測・ビジュアル回帰。

## CI（[test.yml](../../../.github/workflows/test.yml)）

- main への push と main 向け PR で起動
- 単体ジョブ：`gen-sw:check` → `gen-config:check` → `perf-budget:check` → Vitest
- E2E ジョブ：Playwright（CI では `retries: 1`・`workers: 1`）
- Lighthouse：トップ・dtask・piano-pet を計測。警告のみ（accessibility ≥ 0.95、他 ≥ 0.9）でデプロイは止めない
- unit と e2e が両方通ったらデプロイ（→ [architecture.md](./architecture.md#設定デプロイ)）

ローカル Windows では、Playwright のワーカーが終了時に止まり（`worker process did not exit ... force-killed`）、全件成功でも終了コード 1・数分かかることがある（2026-10 に #370〜#379 の作業中に複数回観測）。判定は成功件数とエラー行で行い、CI（Linux）を正とする。

## 手動で確認するもの

実機のスワイプ感、複数端末のリアルタイム同期、実 Firestore でのエラー時の表示。PR は [pull_request_template.md](../../../.github/pull_request_template.md) のチェックリストに沿う。

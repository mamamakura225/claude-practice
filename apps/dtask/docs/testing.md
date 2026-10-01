# テスト戦略

## 全体方針

純粋関数（`utils/`配下）は **Vitest による単体テスト** で網羅、UIを伴う動作確認は **Playwright による E2E テスト** で代表的フローを保証する2層構成。

| 層 | ツール | 対象 | 速度 | 安定性 |
|---|---|---|---|---|
| 単体 | Vitest | utils/ の純粋関数 | 速い | 高い |
| E2E | Playwright（Chromium 全件＋`@compat` のみ Firefox/WebKit） | ブラウザ全体フロー | 遅い | 中 |

## 単体テスト (Vitest)

設定：[vitest.config.js](../../../vitest.config.js)

```bash
npm test          # 全テスト実行（vitest run）
```

テスト配置：[tests/](../tests/) 配下、 `*.test.js`

| ファイル | カバレッジ |
|---|---|
| [tests/task.test.js](../tests/task.test.js) | `normalizeTask`（デフォルト値補完）、`calculateSubtaskProgress`（0/100%/中間値） |
| [tests/date.test.js](../tests/date.test.js) | `formatDate`, `isOverdue`, `addDays`, `addMonths`, `nextRecurrenceDeadline`, `daysBetween`。**ローカル日付の境界**（`process.env.TZ` を実行時に Asia/Tokyo 07:00・America/Los_Angeles 20:00 へ切替え、時刻固定で `todayStr`/期限切れ/明日/今日プリセットを検証 #350）、毎月の月末詰めと `anchorDay`（#351） |
| [tests/filter.test.js](../tests/filter.test.js) | `filterTasks`（カテゴリ・優先度・ステータス・期限プリセット・フリーテキスト/タグ検索） |
| [tests/sort.test.js](../tests/sort.test.js) | `sortTasks`（manual/createdAt/deadline/priority、完了タスク末尾保証） |
| [tests/html.test.js](../tests/html.test.js) | `escHtml`（XSS対策） |
| [tests/color.test.js](../tests/color.test.js) | `readableTextColor`（AA未達だった色・極端な色でもライト/ダーク両面で 4.5:1）、`safeColor`（不正値の置換） #354 |
| [tests/sync.test.js](../tests/sync.test.js) | `mergeFallbackChanges`（ローカル追加/編集/削除の載せ直し、フィールド単位の重ね合わせ、空フォールバックでクラウドを消さない #349） |

### 単体テスト方針
- `utils/` への新規追加・変更時は必ずテストを追加または更新
- エッジケース（空配列、null、未設定フィールド）を意識
- 純粋関数のみ対象。DOM・Firebase・localStorage は単体テストでは扱わない

## E2E テスト (Playwright)

設定：[playwright.config.js](../../../playwright.config.js)

```bash
npm run test:e2e   # E2Eテスト実行
```

- 主要テストは Chromium（Desktop Chrome）で全件実行
- 互換性検証は `@compat` タグ付きのクリティカルパスのみ Firefox / WebKit(Safari) でも実行（[playwright.config.js](../../../playwright.config.js) の `dtask-firefox` / `dtask-webkit` プロジェクト。全件は重いためタグで限定）
- `http-server` をテスト開始時に自動起動（port 3000）
- CI では `retries: 1`, `workers: 1`

テスト配置：[e2e/](../e2e/) 配下、 `*.spec.js`

### 現状カバレッジ
| ファイル | カバー範囲 |
|---|---|
| [e2e/add-task.spec.js](../e2e/add-task.spec.js) | 詳細モーダルから新規タスク作成 → リストに表示（`@compat`）。Firestore APIをブロックしてオフライン挙動を検証 |
| [e2e/kanban.spec.js](../e2e/kanban.spec.js) | Kanban へ切替えてステータスセレクトで進行中へ変更 |
| [e2e/kanban-full-cycle.spec.js](../e2e/kanban-full-cycle.spec.js) | todo → inprogress → done で対応する列へ移動（`@compat`） |
| [e2e/filter-sort.spec.js](../e2e/filter-sort.spec.js) | ステータス・優先度フィルタ、優先度順ソート、期限プリセット「期限切れ」 |
| [e2e/search.spec.js](../e2e/search.spec.js) | 検索バーの部分一致絞り込み |
| [e2e/subtasks.spec.js](../e2e/subtasks.spec.js) | 詳細モーダルでサブタスク2件追加 → カードに進捗表示 |
| [e2e/subtask-inline.spec.js](../e2e/subtask-inline.spec.js) | カード上のインライン操作：0件からの追加、チェックで進捗 0/2→1/2→2/2、タイトル編集 |
| [e2e/swipe-delete.spec.js](../e2e/swipe-delete.spec.js) | モバイルエミュレーションで左スワイプ削除 → トースト |
| [e2e/keyboard-shortcuts.spec.js](../e2e/keyboard-shortcuts.spec.js) | `N` / `/` のフォーカス、`Esc` でモーダルを閉じる、入力中は無効 |
| [e2e/undo-shortcut.spec.js](../e2e/undo-shortcut.spec.js) | 削除後の `Ctrl+Z` 復元、入力中は無効、連続 Undo |
| [e2e/today-home.spec.js](../e2e/today-home.spec.js) | 「今日やること」ホームビュー(#33)：起動時 today フィルタON（今日＋期限切れ表示・未来非表示）、ビュー形式の localStorage 復元、今日分全完了時のご褒美空状態、日本時間早朝（`timezoneId`＋`page.clock` で 07:00 JST 固定）でも今日締切を表示する日付境界(#350) |
| [e2e/card-menu.spec.js](../e2e/card-menu.spec.js) | カード操作メニュー(#111)：⋮ から削除・下へ並び替え・完了化、キーボードでの開閉（Enter/Esc・フォーカス復帰） |
| [e2e/a11y.spec.js](../e2e/a11y.spec.js) | アクセシビリティ(#354)：表示中の全文字のコントラスト（ライト/ダーク×リスト/ボード）、モバイルのタップ領域、ARIA（読み上げ名・期限プリセットの aria-pressed）、モーダル後のフォーカス復帰、同期表示（送信待ち・保存失敗の維持。偽SDK） |
| [e2e/layout.spec.js](../e2e/layout.spec.js) | 表示崩れの退行防止(#353)：幅320/390pxでヘッダーが収まりロゴ1行、色ドットが円、モバイルKanban列が画面幅以内、ステータスバッジが優先度と別の見た目 |
| [e2e/quick-add-today.spec.js](../e2e/quick-add-today.spec.js) | 今日ビューからの追加(#352)：クイック追加が期限=今日で表示される、詳細モーダルの期限初期値、見えない追加のトースト＋「すべて表示」、トーストはフォーカス中は消えない |
| [e2e/recurrence.spec.js](../e2e/recurrence.spec.js) | 繰り返しタスク(#351)：✓・⋮・Kanbanセレクト・Kanban D&D・編集モーダルの各経路で次回分が1件できる、再完了で重複しない、毎月31日→2/28→3/31、スキップ |
| [e2e/offline-fallback.spec.js](../e2e/offline-fallback.spec.js) | オフライン起動中の同期安全性(#349)：Firebase SDK を偽モジュールに `page.route` で差し替え、フォールバック中は書込まない・端末に残る・クラウド到着時の差分マージ・キャッシュ由来スナップショットの無視・再起動をまたぐ未同期分・通常起動後のオフライン編集・編集なしのオフライン→復帰で書かない・自分の書込み確認で再描画しない を検証 |

> spec 内で期限日を作るヘルパ（`isoDay` 等）はアプリと同じ**ローカル日付**で組み立てる。`toISOString()` を使うと、ローカル実行（JST）の 0〜9時だけアプリとずれる（#350）。

> 起動既定が「今日」フィルタ(#33)のため、全件表示を前提とする既存 spec は冒頭で「すべて」chip へ切替える `showAll(page)` ヘルパを通す。

### E2E方針
- 数より重要度。クリティカルパスを覆うことを優先
- Firebase API はテスト中ブロックして再現性を確保（localStorage フォールバック挙動でテスト）
- 同期経路そのものを検証する spec（offline-fallback / a11y の同期表示）は、Firebase SDK を `page.route` で偽モジュールに差し替える
- 視覚回帰やパフォーマンス計測は本テストでは扱わない

### 拡充
未カバーの主要機能（プロジェクト・表示設定・クイック追加チップ等）は GitHub Issues で管理（#356）。

## CI (GitHub Actions)

[.github/workflows/test.yml](../../../.github/workflows/test.yml) で以下を自動実行：

- **main への push と main 向け PR で起動**（PR ブランチへの push では起動しない。二重実行を避けるため）
- 単体ジョブ：`gen-sw:check`（piano-pet のキャッシュ版）・`gen-config:check`（Firebase/監視設定の生成物ドリフト）・`perf-budget:check`（gzip 予算）→ Vitest
- Playwright E2E：dtask は Chromium で全件、`@compat` タグの付いたテストだけ Firefox / WebKit でも実行
- unit と e2e が両方成功したときだけ Vercel へデプロイ（main push＝本番、PR＝プレビュー。Dependabot の PR はプレビュー対象外）
- **Lighthouse 定点観測**（`lighthouse` ジョブ）：[lighthouserc.json](../../../lighthouserc.json) を使い、トップ / dtask / piano-pet の各 URL で performance / accessibility / best-practices / seo を計測。**警告のみ（`warn`）でデプロイをブロックしない**定点観測用。閾値は accessibility ≥ 0.95、その他 ≥ 0.9。結果は artifacts にアップロード（`treosh/lighthouse-ci-action`）

> **不在**: Lint / 型チェック / カバレッジ計測 / ビジュアル回帰テスト。必要に応じて段階的に追加する。

## 手動テスト

自動化が難しい以下は手動確認：

- 実機モバイルでのスワイプ感
- 複数デバイス間のリアルタイム同期挙動
- ダークモード／文字サイズ切替後の視認性
- 実 Firestore でのエラー時UI（オフライン化・権限エラー）

PRレビュー時は [pull_request_template.md](../../../.github/pull_request_template.md) のチェックリストに沿って実施。

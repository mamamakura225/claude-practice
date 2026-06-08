# テスト戦略

## 全体方針

純粋関数（`utils/`配下）は **Vitest による単体テスト** で網羅、UIを伴う動作確認は **Playwright による E2E テスト** で代表的フローを保証する2層構成。

| 層 | ツール | 対象 | 速度 | 安定性 |
|---|---|---|---|---|
| 単体 | Vitest | utils/ の純粋関数 | 速い | 高い |
| E2E | Playwright (Chromium) | ブラウザ全体フロー | 遅い | 中 |

## 単体テスト (Vitest)

設定：[vitest.config.js](../../../vitest.config.js)

```bash
npm test          # 全テスト実行（vitest run）
```

テスト配置：[tests/](../tests/) 配下、 `*.test.js`

| ファイル | カバレッジ |
|---|---|
| [tests/task.test.js](../tests/task.test.js) | `normalizeTask`（デフォルト値補完）、`calculateSubtaskProgress`（0/100%/中間値） |
| [tests/date.test.js](../tests/date.test.js) | `formatDate`, `isOverdue`, `addDays`, `addMonths`, `nextRecurrenceDeadline` |
| [tests/filter.test.js](../tests/filter.test.js) | `filterTasks`（カテゴリ・優先度・ステータス・期限プリセット・フリーテキスト/タグ検索） |
| [tests/sort.test.js](../tests/sort.test.js) | `sortTasks`（manual/created/deadline/priority、完了タスク末尾保証） |
| [tests/html.test.js](../tests/html.test.js) | `escHtml`（XSS対策） |

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
| [e2e/add-task.spec.js](../e2e/add-task.spec.js) | クイック追加バーから新規タスク作成→リストに表示されることを確認。Firestore APIをブロックしてオフライン挙動を検証 |
| [e2e/today-home.spec.js](../e2e/today-home.spec.js) | 「今日やること」ホームビュー(#33)：起動時 today フィルタON（今日＋期限切れ表示・未来非表示）、ビュー形式の localStorage 復元、今日分全完了時のご褒美空状態 |
| [e2e/card-menu.spec.js](../e2e/card-menu.spec.js) | カード操作メニュー(#111)：⋮ から削除・下へ並び替え・完了化、キーボードでの開閉（Enter/Esc・フォーカス復帰） |

> 起動既定が「今日」フィルタ(#33)のため、全件表示を前提とする既存 spec は冒頭で「すべて」chip へ切替える `showAll(page)` ヘルパを通す。

### E2E方針
- 数より重要度。クリティカルパスを覆うことを優先
- Firebase API はテスト中ブロックして再現性を確保（localStorage フォールバック挙動でテスト）
- 視覚回帰やパフォーマンス計測は本テストでは扱わない

### 拡充候補（バックログとして起票予定）
- サブタスクの追加・編集・チェック切替
- Kanban カードのステータス変更
- フィルタ・ソート切替
- キーボードショートカット
- スワイプ削除（モバイルエミュレーション）

## CI (GitHub Actions)

[.github/workflows/test.yml](../../../.github/workflows/test.yml) で以下を自動実行：

- すべての push、main 向け PR で起動
- Vitest 単体テスト
- Playwright E2E テスト
- **Lighthouse 定点観測**（`lighthouse` ジョブ）：[lighthouserc.json](../../../lighthouserc.json) を使い、トップ / dtask / piano-pet の各 URL で performance / accessibility / best-practices / seo を計測。**警告のみ（`warn`）でデプロイをブロックしない**定点観測用。閾値は accessibility ≥ 0.95、その他 ≥ 0.9。結果は artifacts にアップロード（`treosh/lighthouse-ci-action`）

> **不在**: Lint / 型チェック / カバレッジ計測 / ビジュアル回帰テスト。必要に応じて段階的に追加する。

## 手動テスト

自動化が難しい以下は手動確認：

- 実機モバイルでのスワイプ感
- 複数デバイス間のリアルタイム同期挙動
- ダークモード／文字サイズ切替後の視認性
- 実 Firestore でのエラー時UI（オフライン化・権限エラー）

PRレビュー時は [pull_request_template.md](../../../.github/pull_request_template.md) のチェックリストに沿って実施。

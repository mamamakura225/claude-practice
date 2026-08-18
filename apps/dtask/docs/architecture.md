# アーキテクチャ（設計書）

> **更新ルール**: `apps/dtask/` のソースを変更したら関連docsへ必ず反映（[CLAUDE.md](../../../CLAUDE.md)）。

## 全体像

dtask は **Vanilla JavaScript の SPA**で、ビルドツールを使わず ES Modules を直接ブラウザに読み込む構成。データは Firebase Firestore にクラウド永続化される。

```
┌──────────────────────────────────────┐
│  ブラウザ                              │
│  ┌──────────────┐                    │
│  │ index.html   │ ← エントリ           │
│  └──────┬───────┘                    │
│         │                            │
│  ┌──────▼───────────────────────┐    │
│  │ app.js  (約1600行)            │    │
│  │  ├─ state / uiState           │    │
│  │  ├─ Firestore 同期             │    │
│  │  ├─ レンダリング (List/Kanban) │    │
│  │  ├─ イベントハンドラ           │    │
│  │  └─ utils/ 呼び出し            │    │
│  └──────┬────────────────────────┘    │
│         │                             │
│  ┌──────▼──────┐  ┌─────────────┐    │
│  │ utils/      │  │ localStorage│    │
│  │ ├ date.js   │  │ (UI状態のみ) │    │
│  │ ├ task.js   │  └─────────────┘    │
│  │ ├ filter.js │                      │
│  │ ├ sort.js   │                      │
│  │ └ html.js   │                      │
│  └─────────────┘                      │
└──────────────────────────────────────┘
                │
                ▼
        ┌───────────────┐
        │ Firestore     │
        │ dtask/data    │
        │ {tasks,       │
        │  categories}  │
        └───────────────┘
```

## ファイル構成

| パス | 役割 |
|---|---|
| [index.html](../index.html) | エントリHTML、UI要素の宣言 |
| [app.js](../app.js) | メインロジック（状態管理／同期／レンダリング／イベント） |
| [style.css](../style.css) | スタイル |
| [firebase-config.js](../firebase-config.js) | Firebase接続設定（`gen-config` が環境変数から生成） |
| [monitoring-config.js](../monitoring-config.js) | Sentry DSN / PostHog キー（`gen-config` が生成・未設定なら空） |
| [sentry.js](../sentry.js) | エラー監視の初期化（キー未設定なら no-op） |
| [analytics.js](../analytics.js) | PostHog 利用計測（操作種別・頻度のみ。内容は送らない） |
| [utils/date.js](../utils/date.js) | 日付計算（formatDate, isOverdue, addDays, addMonths, nextRecurrenceDeadline） |
| [utils/task.js](../utils/task.js) | タスク正規化（normalizeTask）、サブタスク進捗計算（calculateSubtaskProgress） |
| [utils/filter.js](../utils/filter.js) | filterTasks（カテゴリ・優先度・ステータス・期限プリセット・検索） |
| [utils/sort.js](../utils/sort.js) | sortTasks（手動 / 作成日 / 期限 / 優先度。完了タスクは常に末尾） |
| [utils/html.js](../utils/html.js) | escHtml（XSS対策） |
| [vercel.json](../../../vercel.json) | SPA用URLリライト（リポジトリルートに集約） |

## 状態管理

`app.js` 冒頭の `state` / `uiState` 2つのオブジェクトにアプリ状態を集約している。ただし**永続化先はフィールドごとに異なる**点に注意（`state` ＝ クラウド永続化、ではない）。

### `state`（実行時の中心状態）
| フィールド | 型 | 永続化先 |
|---|---|---|
| `tasks` | Task配列 | **Firestore**（`saveCloud` が書込） |
| `categories` | Category配列 | **Firestore**（同上） |
| `theme` | `'light'` \| `'dark'` | **localStorage**（`dtask_theme`）。クラウド非同期 |
| `currentView` | `'list'` \| `'kanban'` | **localStorage**（`dtask_view`）。`switchView` で保存し `init` で復元(#33) |
| `filters` | フィルタ・ソート・検索条件 | **永続化なし**（メモリのみ。リロードで既定にリセット。ただし `preset` の既定は `'today'`=「今日やること」固定(#33)） |

> **重要**: クラウド（Firestore）へ書き込むのは `saveCloud()` の `setDoc(DATA_DOC, { tasks, categories })` のみ。`theme` / `currentView` は localStorage（クラウド非同期）、`filters` はメモリ上の一時状態でクラウド同期されない。

### `uiState`（端末ローカル、クラウド非同期）
- `expanded`: `Set<taskId>` — インライン展開中のタスクIDセット（localStorage `dtask_expanded` に永続化）

> **設計判断**: 展開状態をクラウド同期しないのは、デバイス間で展開状態を共有することがUX上不要なため（端末ごとに独立した「いま見ている」状態として扱う）。テーマ・文字サイズも同様に端末固有として localStorage に分離している（→ [data-model.md](./data-model.md)）。

詳細スキーマは [data-model.md](./data-model.md) を参照。

## 同期方式

同期ロジックは `app.js` の `saveCloud` / `loadStorage` / `setSyncState` 周辺。

- **読み込み**: 起動時に `getDoc(DATA_DOC)` で初期ロード。**5秒タイムアウト**でlocalStorageへフォールバック（オフライン・障害時にもUI起動可）。
- **リアルタイム同期**: `onSnapshot` で他デバイスからの変更を即時反映。
- **書き込み**: 変更が起きるたびに `saveCloud()` → `setDoc(DATA_DOC, {tasks, categories})` で全体置換。
- **同期状況UI**: 画面上部の `#syncIndicator` に `idle` / `syncing` / `saved` / `error` / `offline` を表示（`setSyncState`）。
- **オフライン検知**: `window` の `online` / `offline` イベント（`addEventListener`）で状態切替、復帰時に自動リトライ。

## レンダリング戦略

- **命令型 DOM 操作**：仮想DOMやテンプレートエンジンは使わず、`innerHTML` でカード単位を組み立て。
- **全画面再描画**：状態変化のたびに `render()` → `renderListView()` または `renderKanbanView()` を実行。
- **Fiber アニメーション**：CSS カスタムプロパティ `--card-i` でカードごとに stagger 表示（重い計算は避けつつ視覚的にリッチ）。

> **設計判断**: シンプルさ優先のため再描画コストを許容している。タスク件数が数百を超える規模になったらこの戦略は再考する。

## イベント処理

- ドキュメント全体への単一リスナー + `data-action` 属性で操作タイプを分岐（イベント委譲パターン）。
- スワイプ（モバイル）、D&D（デスクトップのみ）、キーボードショートカットはそれぞれ専用ハンドラ。

## 依存ライブラリ

実行時依存：
- Firebase SDK 12.13.0（CDN直読み）
- Sentry / PostHog（任意。`monitoring-config.js` に鍵がある場合のみ CDN から動的 import。未設定なら no-op）

開発時依存（[package.json](../../../package.json)）：
- `vitest` — 単体テスト
- `@playwright/test` — E2Eテスト
- `http-server` — ローカル/E2E用静的サーバ

> **設計判断**: ビルドツールを入れていないのは、依存最小化と学習コスト軽減のため。将来TypeScript化やバンドル最適化が必要になればViteなどを検討する。

## 設定情報

Firebase設定は [firebase-config.js](../firebase-config.js) に集約し、`app.js` が import する（`getFirestore` → `doc(db, 'dtask', 'data')`）。`firebase-config.js` と監視用 `monitoring-config.js` は `npm run gen-config`（[scripts/gen-firebase-config.mjs](../../../scripts/gen-firebase-config.mjs)）が `FIREBASE_*` / `SENTRY_DSN` 等の環境変数から生成する。env未設定時は本番値（DSNは空＝Sentry無効）にフォールバックし、CIの `gen-config:check` がドリフトを検知する。

Web APIキーや Sentry DSN は公開しても安全な種類で、秘匿目的ではなく**環境分離（将来のステージング）**のための継ぎ目。Firestore のアクセス制御はセキュリティルールで行う前提。

## デプロイ方式

GitHub Actions のテスト (Vitest + Playwright) が両方 success になった場合にのみ Vercel へデプロイする構成。テスト失敗時に本番が更新されるリスクを排除している。

```
push / PR
   │
   ▼
┌─────────────┐  ┌─────────────┐
│ Vitest      │  │ Playwright  │  ← .github/workflows/test.yml
│ (unit)      │  │ (e2e)       │
└──────┬──────┘  └──────┬──────┘
       │ 両方 success    │
       └────────┬────────┘
                ▼
        ┌──────────────┐
        │ Vercel CLI   │  ← needs: [unit, e2e]
        │  - prod (mainへのpush時)
        │  - preview (PR時)
        └──────────────┘
```

- **Vercelのgit自動デプロイは無効化**：`vercel.json` の `git.deploymentEnabled: false` により、Vercel が GitHub の push を受けて自動デプロイすることを止めている。
- **CLI からのデプロイ**：`.github/workflows/test.yml` の `deploy-production` / `deploy-preview` ジョブが `vercel pull` → `vercel build` → `vercel deploy --prebuilt` を実行する。
- **必要なGitHub Secrets**：`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`。値はVercelダッシュボードとプロジェクトルートで `vercel link` 後に生成される `.vercel/project.json` から取得する。

> **方針判断**：Vercelの「Deployment Protection」(Required Checks) は Pro プラン以上で利用可能なため、無料プランでも動かせる「GitHub Actions経由でCLIデプロイ」方式を採用した（issue #43）。

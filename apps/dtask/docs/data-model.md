# データモデル

型と保存先。同期の方式は [architecture.md](./architecture.md#同期)。

## 保存先

| データ | 保存先 |
|---|---|
| タスク・プロジェクト | Firestore `dtask/data`（`{tasks: Task[], categories: Category[]}` の単一ドキュメント）＋ localStorage ミラー |
| テーマ・文字サイズ・ビュー形式・サブタスク展開 | localStorage（端末ごと。同期しない） |
| 絞り込み・並べ替え | メモリのみ（リロードで既定に戻る） |

> **設計判断**: タスクごとにドキュメントを分けないのは、個人利用で量が小さく、全件購読の方が同期が単純だから（数百件を超えたら再設計）。表示設定を同期しないのは、端末ごとの「いま見ている状態」だから。

## Task

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | UUID |
| `title` | string | ✓ | タスク名 |
| `description` | string |  | メモ |
| `status` | `'todo'` \| `'inprogress'` \| `'done'` | ✓ | ステータス |
| `priority` | `'high'` \| `'medium'` \| `'low'` |  | 優先度 |
| `categoryId` | string |  | プロジェクトID（空＝なし） |
| `deadline` | `YYYY-MM-DD` |  | 期限（端末ローカルの日付。空＝なし） |
| `tags` | string[] |  | 既定 `[]` |
| `subtasks` | Subtask[] |  | 既定 `[]` |
| `recurrence` | Recurrence \| null |  | 既定 `null` |
| `order` | number |  | 手動順。既定 `0` |
| `spawnedNextId` | string |  | 完了時に作った次回分のID（再完了での重複防止） |
| `createdAt` | ISO8601 | ✓ | 作成日時（UTC） |

読み込み時に [utils/task.js](../utils/task.js) の `normalizeTask` が既定値を補う。

| 型 | フィールド |
|---|---|
| Subtask | `id`・`title`・`done: boolean` |
| Category（UI上は「プロジェクト」） | `id`・`name`・`color`（`#RRGGBB`。それ以外は表示時に既定色） |
| Recurrence | `type: 'daily' \| 'weekly' \| 'monthly'`、`anchorDay?: number`（毎月のみ。月末で詰めた翌月に元の日へ戻すための基準日。期限か種別を手で変えたら付け直す） |

間隔は `type` だけで表す（「2週間ごと」が要るまで `interval` は持たない）。

## localStorage キー

| キー | 内容 |
|---|---|
| `dtask_tasks` / `dtask_categories` | クラウドのミラー（保存・受信のたびに更新。Firestore が応答しない起動時はここから） |
| `dtask_synced` | 最後にクラウドと一致した `{tasks, categories}`（未同期分の差分を求める基準） |
| `dtask_theme` | `'light'` / `'dark'` |
| `dtask_fontsize` | `'standard'` / `'large'` |
| `dtask_view` | `'list'` / `'kanban'` |
| `dtask_expanded` | 展開中のタスクID（削除済みIDは自動で除く） |
| `dtask_hint_actions` | ⋮メニューのヒントを表示済みなら `'1'` |

## Filters（`state.filters`・メモリのみ）

| プロパティ | 値 | 既定 |
|---|---|---|
| `categoryId` / `priority` / `status` | 各値、空＝すべて | `''` |
| `search` | 文字列（`#タグ` はタグ完全一致） | `''` |
| `hideCompleted` | boolean | `false` |
| `preset` | `''` / `'today'` / `'week'` / `'overdue'` | `'today'`（起動時は常に今日） |
| `sort` | `'manual'` / `'createdAt'` / `'deadline'` / `'priority'` | `'manual'` |

## スキーマ変更

マイグレーション機構は無い。追加は `normalizeTask` で既定値を補えば後方互換になる。名前変更・削除をするときは、`normalizeTask` で旧データを吸収し、[tests/task.test.js](../tests/task.test.js) にテストを足し、本書を更新する。

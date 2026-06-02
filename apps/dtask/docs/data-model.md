# データモデル

## Task

タスク本体。Firestore の `dtask/data` ドキュメント内 `tasks` 配列要素として保存される。

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | 一意ID（UUID） |
| `title` | string | ✓ | タスク名 |
| `description` | string |  | 詳細メモ |
| `status` | `'todo'` \| `'inprogress'` \| `'done'` | ✓ | 進捗ステータス |
| `priority` | `'high'` \| `'medium'` \| `'low'` |  | 優先度 |
| `categoryId` | string |  | カテゴリへの参照（空文字なら未分類） |
| `deadline` | `YYYY-MM-DD` |  | 期限（空文字なら未設定） |
| `tags` | string[] |  | タグ配列。デフォルト `[]` |
| `subtasks` | Subtask[] |  | サブタスク配列。デフォルト `[]` |
| `recurrence` | Recurrence \| null |  | 定期タスク設定。デフォルト `null` |
| `order` | number |  | 手動ソート順。デフォルト `0` |
| `createdAt` | ISO8601 string | ✓ | 作成日時 |

正規化は [utils/task.js](../utils/task.js) の `normalizeTask` が担う（読み込み時に `tags`/`subtasks`/`recurrence`/`order` のデフォルト値を補完）。

## Subtask

`Task.subtasks` の要素。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID |
| `title` | string | サブタスク名 |
| `done` | boolean | 完了フラグ |

進捗計算は `calculateSubtaskProgress(subtasks)` → `{ total, done, percent }`。

## Category

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID |
| `name` | string | カテゴリ名 |
| `color` | string | カラーコード（カード上のアクセント色） |

## Recurrence

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | `'daily'` \| `'weekly'` \| `'monthly'` | 繰り返し種別 |
| `interval` | number | 繰り返し間隔。保存時に `1` 固定で書き込まれるが、**現状ロジックでは未参照**（`nextRecurrenceDeadline` は `type` のみ使用）。将来「2週間ごと」等に拡張する余地として保持 |

次回期限の計算は [utils/date.js](../utils/date.js) の `nextRecurrenceDeadline(deadline, recurrence)`。

## Firestore スキーマ

```
dtask (collection)
└── data (document)
    ├── tasks:      Task[]
    └── categories: Category[]
```

> **設計判断**: タスクごとにドキュメントを分けず単一ドキュメントに全件格納している。理由：個人利用前提でデータ量が小さく、`onSnapshot` で全件購読する方が同期実装がシンプルになるため。タスク件数が数百を超える規模では再設計が必要。

## localStorage キー

`app.js` のキー定義（`THEME_KEY` / `FONTSIZE_KEY` / `EXPANDED_KEY`）、および Firestore 障害時フォールバック（`loadStorage` 内の localStorage 読み込み）で使用。

| キー | 型 | 用途 |
|---|---|---|
| `dtask_theme` | string | `'light'` / `'dark'` |
| `dtask_fontsize` | string | `'standard'` / `'large'` |
| `dtask_expanded` | JSON array (string[]) | インライン展開中のタスクIDリスト（削除済みIDは自動クリーンアップ） |
| `dtask_tasks` | JSON Task[] | **フォールバック専用**：Firestoreが応答しないときの一時保存 |
| `dtask_categories` | JSON Category[] | **フォールバック専用**：同上 |

> **設計判断**: UI状態（テーマ、文字サイズ、展開状態）は端末固有として localStorage に分離し、クラウド同期しない。タスクデータ本体は Firestore を正とし、localStorage はあくまで非常時の退避用。

## Filters（実行時状態・非永続）

`state.filters` の構造。**メモリのみ**でクラウド・localStorage いずれにも永続化せず、リロードで既定値にリセットされる（→ [architecture.md](./architecture.md) の状態管理）。`filterTasks` / `sortTasks` の入力となる。

| プロパティ | 型 | 既定 | 説明 |
|---|---|---|---|
| `categoryId` | string | `''` | プロジェクト（categoryId）絞り込み。空＝すべて |
| `priority` | `'high'` \| `'medium'` \| `'low'` \| `''` | `''` | 優先度絞り込み。空＝すべて |
| `status` | `'todo'` \| `'inprogress'` \| `'done'` \| `''` | `''` | ステータス絞り込み。空＝すべて |
| `sort` | `'manual'` \| `'created'` \| `'deadline'` \| `'priority'` | `'manual'` | ソート種別 |
| `search` | string | `''` | 検索クエリ（フルテキスト／`#tag`） |
| `hideCompleted` | boolean | `false` | 完了タスクを非表示 |
| `preset` | `''` \| `'today'` \| `'week'` \| `'overdue'` | `''` | 期限プリセット |

## スキーマ変更時の注意

現在マイグレーション機構はない。フィールド追加程度なら `normalizeTask` でデフォルト値を補完すれば後方互換になるが、フィールド名変更・削除は要注意。スキーマ変更時は：

1. `normalizeTask` を更新し既存データに対するデフォルト動作を保証
2. テスト ([tests/task.test.js](../tests/task.test.js)) を追加
3. `docs/data-model.md`（このファイル）を更新

将来的にはバージョニング戦略を導入したい（[infra issue として起票予定]）。

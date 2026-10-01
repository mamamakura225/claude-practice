# アーキテクチャ

構造と方式、その理由。ふるまいは [features.md](./features.md)、型と保存キーは [data-model.md](./data-model.md)。

## 構成

ビルドツール無しの SPA。ES Modules をそのままブラウザで読み込み、データは Firestore の単一ドキュメント `dtask/data` に `{tasks, categories}` として置く。

| ファイル | 役割 |
|---|---|
| [index.html](../index.html) / [style.css](../style.css) | 画面要素とスタイル |
| [app.js](../app.js) | 状態・同期・描画・イベント（ロジックの大半） |
| [utils/](../utils/) | 純粋関数（単体テスト対象）。`date`（ローカル日付）・`task`（正規化・進捗）・`filter`・`sort`・`html`（エスケープ）・`color`（読める文字色）・`sync`（未同期分のマージ） |
| [firebase-config.js](../firebase-config.js) / [monitoring-config.js](../monitoring-config.js) | 接続設定。`npm run gen-config` が環境変数から生成（直接編集しない） |
| [sentry.js](../sentry.js) / [analytics.js](../analytics.js) | エラー監視・利用計測。鍵が無ければ何もしない。送るのは操作種別のみ（breadcrumb・request・user は送らない） |

実行時依存は Firebase SDK 12.13.0（CDN）のみ。Sentry / PostHog は鍵があるときだけ CDN から動的 import。

## 状態と描画

- `app.js` の `state`（タスク・プロジェクト・テーマ・ビュー・絞り込み）と `uiState`（サブタスク展開）に集約。保存先は項目ごとに違う（→ [data-model.md](./data-model.md)）
- 状態が変わるたびに `render()` が一覧を `innerHTML` で組み直す（仮想DOM無し）。数百件までは許容し、それを超えたら再考する
- イベントは document への委譲＋`data-action` で分岐。スワイプ（モバイル）・D&D（`hover:hover` の端末のみ）・キーボードは専用ハンドラ

## 同期

| 場面 | 方式 |
|---|---|
| 起動 | `getDoc`。5秒で応答が無ければ localStorage のミラーで起動する |
| 他端末の変更 | `onSnapshot`（`includeMetadataChanges: true`）で反映 |
| 保存 | 変更のたびに `setDoc` でドキュメント全体を置換し、localStorage にもミラー |

**未同期モード (#349)**：クラウドの最新を確認できていない間（`cloudLoaded === false`）は `setDoc` しない。

- 入る条件：起動時のフォールバック、または `navigator.onLine === false` の間の編集
- この間：ミラーだけ更新し、同期表示は「未同期」「オフライン」。`online` イベントでも書かない
- 抜けるとき：サーバー由来のスナップショット（`fromCache === false`）か、復帰時の `getDocFromServer` でクラウドが読めたら、`mergeFallbackChanges` で「最後にクラウドと一致した状態」（`dtask_synced`）からのローカル差分をクラウド最新に重ねて書き戻す
  - 既存要素は変更したフィールドだけ上書きする。追加は末尾、ローカル削除はクラウドからも除く
  - クラウドで消えた要素をローカルで編集していたら残す
  - クラウドにドキュメントが無ければ初回とみなしてローカルを上げる
- `dtask_synced` の更新：`getDoc` 成功時、保留書込の無いサーバースナップショット受信時、変更なしのマージ時
  - `setDoc` の成功では更新しない
  - 未同期に入った時点で `dtask_synced` が無ければ、その時のローカルを基準として保存する
- 中身が今の state と同じスナップショット（自分の書込み確認）では再描画しない

保存の進み具合は同期表示に出す（状態一覧は [features.md](./features.md#同期表示)）。

## 日付

期限と「今日」は端末ローカルの `YYYY-MM-DD` 文字列で扱い、[utils/date.js](../utils/date.js)（`todayStr`・`addDays` 等）を通す。比較は文字列比較。`toISOString()` と `new Date('YYYY-MM-DD')` は日付計算に使わない。`createdAt` は時刻なので UTC の ISO8601 のまま。

## 設定・デプロイ

- `*-config.js` は環境変数から生成し、未設定なら本番値（監視は無効）。CI の `gen-config:check` がずれを検知する。値は公開して安全なもので、目的は秘匿でなく環境分離。アクセス制御は Firestore ルール
- デプロイは GitHub Actions（[test.yml](../../../.github/workflows/test.yml)）だけが行う。unit と e2e が両方成功したら Vercel CLI で `vercel pull → build → deploy --prebuilt`（main への push＝本番、PR＝プレビュー）。Vercel の Git 自動デプロイは `vercel.json` の `git.deploymentEnabled: false` で止めている
- Secrets：`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`（値は `vercel link` 後の `.vercel/project.json`）と `FIREBASE_*`・監視用の鍵
- 外部サービス（Firebase / Vercel / Sentry / PostHog）の設定とプライバシー方針は [docs/external-services.md](../../../docs/external-services.md)

## 設計判断

| 判断 | 理由・不採用案 |
|---|---|
| ビルドツールを入れない | 依存と学習コストを最小にする。TypeScript 化やバンドル最適化が要るなら Vite を検討 |
| 全体再描画 | 単純さ優先。数百件を超えたら差分描画を検討 |
| 未同期中は書かない (#349) | `setDoc` は全体置換なので、クラウドを読まずに書くと空・古い状態で全件（や他端末の変更）が消える。旧実装はミラーを書かず、フォールバックの中身は移行前の空データだった |
| 差分の基準をミラーでなく `dtask_synced` に (#349) | ミラーを基準にすると、未同期のまま再起動→再フォールバックで未同期分が基準に溶けて消える |
| フィールド単位でマージ (#349) | 並べ替えは表示中の全タスクの `order` を振り直すので、要素単位だと他端末のタイトル・完了状態を丸ごと巻き戻す |
| `setDoc` 成功で `dtask_synced` を更新しない (#349) | 他端末の変更を含むスナップショットとの順序が保証されず、古い内容で基準を戻しうる |
| 未同期対策に Firestore の永続キャッシュを使わない (#349) | キャッシュ未作成の端末・キャッシュ消去時に同じ全件置換が起きる。未同期中を読み取り専用にする案はオフラインで何もできなくなるので不採用 |
| 日付をローカルの文字列で扱う (#350) | `toISOString()` は UTC なので日本時間 0〜9 時に前日扱いになり、`new Date('YYYY-MM-DD')` は UTC 0時なので UTC より西では当日締切が期限切れになっていた |
| CI 経由でデプロイ (#43) | Vercel の Required Checks は Pro プラン以上。無料プランでも「テストが通ったものだけ本番」にするため |

既知の限界（いずれも単一ユーザー前提で許容）：

- 同じフィールドを2端末で編集したらローカル側が勝つ
- `navigator.onLine` が true のまま Firestore に届かない場合や、回線断の瞬間に送信中だった `setDoc` は、SDK のキューに全件置換として残る。復帰時に送られて他端末の変更を上書きしうる
- #349 以前のコードしか動かしていない端末がフォールバックで起動すると、ミラーは移行前の古いデータになる

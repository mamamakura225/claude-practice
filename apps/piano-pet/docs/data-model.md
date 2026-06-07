# データモデル（設計書）

> **更新ルール**: `apps/piano-pet/` のソースを変更したら、本書・[requirements.md](./requirements.md)（要件定義書）・[features.md](./features.md)（機能詳細）へ必ず反映する。詳細は [CLAUDE.md](../../../CLAUDE.md) の「ドキュメント更新ルール」を参照。

piano-pet の状態は localStorage の単一キー `piano-pet` に JSON オブジェクトとして保存される。
読み込み・正規化・クラウド射影はすべて [js/storage.js](../js/storage.js) に集約されている。

## State スキーマ (v1)

| フィールド | 型 | クラウド同期 | 説明 |
|---|---|:---:|---|
| `version` | number | − | スキーマバージョン。現行 `1`。端末ローカルのみ |
| `pet` | Pet | ✓ | ペット本体 |
| `inventory` | string[] | ✓ | 購入済みショップアイテムID |
| `streak` | Streak | ✓ | 連続練習記録 |
| `badges` | string[] | ✓ | 獲得バッジID |
| `sessions` | Session[] | ✓ | 練習セッション履歴（XP/レベル等の計算元） |
| `assignment` | Assignment \| null | ✓ | きょうの きょく（宿題・#143）。親が設定する単一値。未設定は `null` |
| `settings` | Settings | − | 端末ローカル設定（音など）。クラウド非同期 |

クラウド (Firestore `pianopet/data`) に載るのは `CLOUD_FIELDS`（`pet, inventory, streak, badges, sessions, assignment`）のみ。
`settings` と `version` は端末ローカルに留まる。

### State 以外の localStorage キー（端末ローカル・クラウド非同期）

State 本体（`piano-pet`）とは別に、端末固有の一時フラグを独立キーで持つ。いずれもクラウドに載せない。

| キー | 値 | 用途 |
|---|---|---|
| `piano-pet-onboarded` | `'1'` | 初回オンボーディング（紙芝居・#141）を見たか。端末ごとに案内するため state には含めない（[onboarding.js](../js/onboarding.js)） |
| `piano-pet-backup-before-restore` | State JSON | 復元直前の現行 state を退避（`RESTORE_BACKUP_KEY`・#140） |
| `piano-pet:stamp-draft` | `{ date, stamps: string[] }` | 当日の未記録スタンプ下書き。ホーム戻り→記録再開でカードを引き継ぐ（#164）。打鍵ごとに保存、記録 submit 時に破棄。読み出し時に `date !== todayStr()` なら破棄（日付変更でリセット） |

### Session
1件＝「ある日付の練習記録」。XP・レベル・コイン・ストリーク・バッジの**唯一の計算元**で、編集・削除時は `recomputeState` がこの配列だけから全状態を再構築する。生成は [game.js](../js/game.js) `applySession`、曲の集約は [record-form.js](../js/record-form.js) `collectSongs`。

| フィールド | 型 | 説明 |
|---|---|---|
| `date` | `YYYY-MM-DD` | 練習したローカル暦日。同一日付は記録時に1件へ統合（`mergeSameDaySessions`） |
| `songs` | `Song[]` | 曲ごとの回数リスト（空名・0回以下は除外済み） |
| `totalCount` | number | その日の合計回数（`songs` の `count` 合計） |
| `coinsEarned` | number | その記録で得た**基本**コイン（`calcRewards`。再計算で都度上書き。表示・参照用。おまけは含まない） |
| `xpEarned` | number | その記録で得たXP（同上） |
| `bonusCoins` | number | きょうのおまけ（#148）で得た乱数由来のコイン。**記録に保存して `recomputeState` で復元**（再抽選しない）。0=未当選 |
| `praise` | string \| null | はなまるスタンプ（#145）。親がワンタップで付与する評価。`PRAISE_STAMPS` の id（`hanamaru`/`jouzu`/`ganbatta`）か未設定の `null`。曲数からは導出されないが、全状態のスプレッド更新（`recomputeState`・各種マージ）で保持される。表示時に `normalizePraise` で検証 |

### Song
| フィールド | 型 | 説明 |
|---|---|---|
| `name` | string | 曲名（前後空白はトリム済み） |
| `count` | number | その曲の回数（正の整数） |

### 派生データ（保存しない）

- **曲の色**（#122）：曲名から決定的ハッシュで色相を算出する（[song-color.js](../js/song-color.js) `songColor`）。保存しないので `sessions` さえ同じならどの端末でも同じ色。スキーマ非依存。
- **曲別の累計回数**（#122）：`sessions` から再集計する（[record-form.js](../js/record-form.js) `songTotals`）。専用フィールドは持たない。
- **曲マスター👑**（#149）：累計回数が `SONG_MASTER_COUNT`（=50）以上かを `isSongMaster` で判定する派生値。専用フィールドは持たず、`songTotals` から再計算しても矛盾しない。
- **なかよしレベルとご褒美解放**（#124）：`pet.affinity` のしきい値から決定的に導出する（[feed.js](../js/feed.js) `affinityLevel` / `affinityRewards`）。**解放済みフラグは持たない**。`recomputeState` は `pet.affinity` を保持するため、記録の編集・削除（全再計算）でも解放状態が矛盾しない。> **設計判断**: Issue では「解放済みフラグを `pet` に追加」案だったが、affinity 自体が単調増加で永続化済みのため、フラグを別持ちすると二重管理になり再計算との整合リスクが生じる。affinity からの導出に一本化した。

### Pet
| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | string | `'きーちゃん'` | 猫の名前 |
| `level` | number | `1` | XPから算出される現在レベル |
| `xp` | number | `0` | 累計経験値 |
| `coins` | number | `0` | 所持コイン（= 獲得総額 − 装備購入 − えさ消費）。記録の編集・削除時の全再計算（`recomputeState`）では `Math.max(0, 獲得総額 − spent)` で再導出する。`spent` ＝ 装備購入総額（`spentCoins`＝インベントリ価格合計）＋ `foodSpent` の合算で、[app.js](../js/app.js) が算出して渡す（→ 購入・えさ消費分が再計算で復活しない） |
| `equippedItems` | string[] | `[]` | 装備中アイテムID（スロットごとに1つ） |
| `itemLayout` | object | `{}` | 衣装の自由配置座標 `{ itemId: {x_pct, y_pct} }`（#168・ステージ%）。未登録は既定アンカー位置で描画。装備外しは `cleanItemLayout` が掃除 |
| `affinity` | number | `0` | なかよし度（えさやりで上昇）。3段階tier（low/mid/high）に集約され猫画像の表情・ポーズに反映（#167） |
| `foodSpent` | number | `0` | えさに使ったコイン総額（全再計算で消費分を復活させないため） |

### Streak
| フィールド | 型 | デフォルト |
|---|---|---|
| `current` | number | `0` |
| `best` | number | `0` |
| `lastPracticeDate` | `YYYY-MM-DD` \| null | `null` |
| `freezes` | number | `0` |

> **注**: ストリークが途切れて救済もできなかった場合、`current` は 1 にリセットされるが **`freezes`（お休み券）は没収されず維持される**（[game.js](../js/game.js) `updateStreak`）。獲得済みの券は連続が切れても持ち越せる。
> **注**: `updateStreak` の戻り値には「そのとき何日ぶん救済したか」を示す一時プロパティ `frozeDays` が含まれるが、これは記録直後のポップアップ表示用で**永続化されない**（`DEFAULTS.streak` にもクラウドにも持たない）。`streak` スキーマのフィールドと誤認しないこと。

### Settings
| フィールド | 型 | デフォルト |
|---|---|---|
| `soundOn` | boolean | `true` |

### Assignment（きょうの きょく・#143）
親が「先生の宿題」を代理登録する単一値。ホームに大きなカードで表示し、達成で特別演出を出す。純粋ロジックは [assignment.js](../js/assignment.js)。

| フィールド | 型 | 説明 |
|---|---|---|
| `items` | `{ name, target }[]` | 宿題の曲リスト。**MVP は先頭1件のみ**を入力・表示（`primaryItem`）。スキーマは将来の複数曲拡張に備え配列 |
| `period` | `'day'` \| `'week'` | 目標期間。`day`=当日、`week`=今週（**月曜始まり**・`history.js` `weekStart` に追従し週次グラフと一致） |
| `setAt` | ISO文字列 | 設定時刻。クラウド競合解決（LWW）に使う |

- **達成判定は `sessions` から導出**（`assignmentProgress`）。対象曲の period 内合計回数が `target` 以上なら達成。専用の達成フラグは持たない（曲色・なかよし同様）。記録の編集・削除で全再計算しても矛盾しない。
- **クリアはトゥームストーン**：`items: []`＋新しい `setAt`。`null` でなく空配列にすることで「消した」操作も LWW で他端末へ伝播する。`hasAssignment` は `items` が空なら false。
- **演出**：記録適用前後で `assignmentProgress(...).achieved` が `false→true` に切り替わったときだけ、紙吹雪（`playCelebrate`）＋達成ポップアップを出す（[app.js](../js/app.js) `assignmentJustAchieved`）。遷移検出なので達成済みの日に追記しても再演出されず、フラグ不要。

> **設計判断**: `assignment` は `sessions` から導出されない単一値のため、クラウドマージは sessions の keep-larger とは別に **`setAt` の Last-Write-Wins**（`pickNewerAssignment`・片方 null は非 null 優先）で解決する。親が直近に設定した宿題が正、というデータ性質に合致する。`mergeCloud`(cloud-wins) / `mergeCloudInitial`(ローカル優先) の両経路で LWW を適用する。
>
> **設計判断（達成ボーナスコインの先送り）**: 設計レビューでは達成ボーナスコイン（🪙+5）案も出たが、コインは `sessions` から `recomputeState` で全再計算される派生値のため、宿題ボーナスを永続させるには affinity/foodSpent 同様の別アキュムレータと全再計算経路の改修が必要になる。MVP（軽量 M）では**特別演出（紙吹雪＋ポップアップ）のみ**とし、ボーナスコインは別Issueの拡張余地とした。
>
> **設計判断（きょうのおまけ #148 のコイン永続）**: 上記の「派生値だから乱数ボーナスを足せない」制約を、別アキュムレータではなく**記録への保存値（`bonusCoins`）**で解決した。乱数抽選は app.js 側（`rollDailyBonus(Math.random())`）でその日の初回記録時のみ行い、結果を `applySession(state, session, bonusCoins)` に渡して記録へ焼き込む。`recomputeState` は `s.bonusCoins` を `earned` に再加算するため、編集・削除・クラウドマージ後も再抽選されず金額が保たれる。`game.js` は純粋なまま（乱数は注入）。

正規化は `normalizeState(saved)` が担い、`pet`/`streak`/`settings` の不足キーを `DEFAULTS` で補完する（`assignment` はトップレベルの単純値なので spread でそのまま引き継がれる）。
フィールド追加程度であれば正規化のデフォルト補完だけで済むため、スキーマバージョンを上げる必要はない（`assignment` 追加も `DEFAULTS.assignment: null` の補完だけで migration 不要）。

## マイグレーション戦略

破壊的なスキーマ変更（フィールドの削除・改名、ネスト構造の変更、配列要素の形式変更など）に備え、
state にバージョン番号を埋め込み、読み込み時に順次マイグレーションを適用する方式を採る。

### 仕組み

- `SCHEMA_VERSION`（storage.js）が現行バージョン。state の `version` フィールドに保存される。
- `MIGRATIONS` は移行ステップの配列。`MIGRATIONS[n]` は **v(n) の state を v(n+1) の形に変換する純粋関数**。
- `migrate(saved)` が保存データの `version` を現行まで順に引き上げる。
  - `version` を持たない旧データは **v0** とみなす。
  - 現行より新しいデータ（ダウングレード時など）は**バージョンを下げず**そのまま返す。
- 読み込みフローは `loadState()` → `migrate()` → `normalizeState()` の順。
  移行で構造を整えた後にデフォルト補完を行う。

### スキーマを変更する手順

1. `storage.js` の `DEFAULTS` を新しい形に更新する。
2. `SCHEMA_VERSION` を +1 する。
3. `MIGRATIONS` 配列の末尾に、**直前バージョン → 新バージョン**の変換関数を追加する。
   - 入力 state を破壊せず、変換後のオブジェクトを返す（`version` の付与は `migrate()` が行うので不要）。
4. `tests/storage.test.js` に「旧スキーマ → 新スキーマ」の移行テストを追加する。
5. この表（State スキーマ）とバージョンを更新する。

### 例

```js
// v1 → v2: streak.freezes を廃止し maxFreezes に改名する場合
export const SCHEMA_VERSION = 2;

const MIGRATIONS = [
  (s) => s,                                    // v0 → v1
  (s) => ({                                    // v1 → v2
    ...s,
    streak: {
      ...s.streak,
      maxFreezes: s.streak?.freezes ?? 0,
    },
  }),
];
```

## クラウド側の制約

Firestore に保存されるデータには `version` を含めていない（`CLOUD_FIELDS` 外）。
各端末は読み込み時に自分のローカルコピーをマイグレーションする。

現状の `mergeCloud(local, cloud)` はクラウドデータに `migrate()` を適用せず、`normalizeState` による
デフォルト補完のみで取り込む。**クラウド同期対象フィールド（`sessions` 等）の構造を破壊的に変更する
マイグレーションを追加する場合**は、`mergeCloud` 内でも取り込み前にクラウドペイロードへ移行処理を
適用する必要がある。フィールド追加レベルの変更であれば `normalizeState` の補完で対応できる。

## 起動シーケンスとクラウド同期（ローカルファースト・#142）

起動時は localStorage を即座に読み込んでホームを同期描画し、クラウド同期は完全にバックグラウンドで走る。

1. `loadState()`（localStorage）→ `renderHome()` を**同期実行**（最初の描画はクラウドを待たない）。
2. クラウド同期の起動（`initCloudSync`）は **`requestIdleCallback`**（非対応環境は `setTimeout` フォールバック）で**アイドル時間まで遅延**。Firebase SDK の動的 import（CDN 取得）と初期化はこの時点で初めて走り、初回描画・操作と競合しない。
3. オフライン等で SDK 取得に失敗してもローカル動作は妨げない（`online` 復帰で再試行）。

### 初回取り込みのマージ（`mergeCloudInitial` ＝ ローカル優先）

realtime の `onSnapshot` 経路（`applyRemoteState` → `mergeCloud`）は **cloud-wins**（自分の書き込みのエコーは差分比較でスキップ）。一方、**初回 `fetchCloud` の取り込み**で cloud-wins を使うと、idle 同期完了前にローカルで記録した内容を上書き（clobber）してしまう。これを防ぐため初回のみ `mergeCloudInitial(local, cloud)` で**フィールドごとにローカル優先**で突き合わせ、`recomputeState` で導出値を再計算してから反映・push する。

| フィールド | マージ規則 | 理由 |
|---|---|---|
| `sessions` | `mergeSessionsKeepLarger`: date をキーに 1 日 1 件へ解決。両側にあれば `totalCount` の**大きい方**を採用（**合算しない**）。並びは date 降順、同回数の tie はローカル優先。ただし `bonusCoins`（#148）は衝突時に双方の **max** を救済 | sessions は date 一意。合算すると部分同期後の共有ベースを二重計上し、コイン/XP が恒久的に水増しされる。record ID/vector clock が無い前提での安全側。`bonusCoins` は totalCount から導出されない当選値なので keep-larger で消さず max で残す（affinity/foodSpent と同じ哲学） |
| `inventory` | 重複 ID を除いた **union** | 所有は単調増加 |
| `pet.equippedItems` | 両端末の union のうち、マージ後 `inventory` に含まれるものだけ | 未所持の装備を残さない |
| `pet.affinity` / `pet.foodSpent` | **max** | sessions から導出されない累積値 |
| `assignment` | `setAt` の **Last-Write-Wins**（`pickNewerAssignment`・片方 null は非 null 優先）| 親が設定する単一値。keep-larger/合算ではなく直近設定が正（#143）。`mergeCloud` 経路も同じ LWW |
| `pet.coins` / `pet.xp` / `pet.level` / `streak` / `badges` | マージ後の `sessions` から `recomputeState` で再計算 | sessions が唯一の正。`spent = spentCoins(merged inventory) + pet.foodSpent` を第2引数に渡す（`spent` の scalar マージは不要・`spentCoins` が inventory から導出するため） |

マージ結果がクラウドと異なれば（ローカルだけが持つ記録があった等）`pushCloud` で確定する。

### 書き込みの遅延バッチコミット（`pushCloudDebounced` / `flushCloud`・#146）

通常の保存（`commitState`）はローカルへ即時保存したうえで、クラウドへは `pushCloudDebounced`（既定 2000ms）で送る。debounce 中に届いた最新データだけを保持し、スタンプ連打・購入・えさやりなどの連続操作を **1 回の Firestore 書き込みにまとめる**（書き込み回数＝通信量・課金を削減）。確定が必要な境界では `flushCloud()` で保留分を即送信する：

| 契機 | 動作 |
|---|---|
| 記録の確定（`submitRecord`） | `commitState` 直後に `flushCloud()`。記録はバッチ境界なので debounce を待たず確実に送る |
| タブ非アクティブ（`visibilitychange`→hidden）／離脱（`pagehide`） | `flushCloud()` で保留分を確定。バックグラウンド化・タブ閉じで未送信を取りこぼさない |

> **設計判断**: ローカル保存は従来どおり即時（オフラインキャッシュ・損失なし）で、遅延させるのはクラウド送信のみ。debounce を延ばすほど書き込みは減るが反映が遅れるため、ライフサイクル境界（記録確定・タブ離脱）での `flushCloud()` を必須経路にして「まとめつつ取りこぼさない」を両立する。

> **設計判断**（Antigravity との設計レビュー topic_1780534255497 で合意）: 同日衝突の「合算 vs keep-larger」は、無損失（合算）よりも**経済水増しの回避（keep-larger）**を優先した。水増しは不可逆で気づきにくく、ゲーム経済（コイン/レベル/ストリーク）の整合を壊すため。朝スマホ・夜タブレットで別端末・同日記録という稀ケースでは小さい方を失うが、これは record ID 不在ゆえの既存の一般同期の曖昧さであり、合算するには ID か vector clock の導入（#142 スコープ外）が要る。

## バックアップ/復元（JSON 書き出し・読み込み・#140）

認証なし・匿名クラウド同期のため、端末故障やブラウザデータ削除でデータが消えるリスクがある。
親が state を JSON ファイルで手元に保存し、いつでも復元できる安全弁を [js/backup.js](../js/backup.js) に置く（純粋関数中心）。

### バックアップファイル形式

state そのものではなく、識別マーカー付きでラップした JSON を書き出す。

```json
{
  "app": "piano-pet",
  "schemaVersion": 1,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "state": { /* loadState() と同じ state オブジェクト（version 含む） */ }
}
```

ファイル名は `piano-pet-backup-YYYY-MM-DD.json`。`exportState(state)` が文字列化を担い、Blob 化と
`a[download]` でのダウンロードは [app.js](../js/app.js) 側が行う。

### 復元時の検証（`parseBackup(text)`）

取り込みは純粋関数 `parseBackup` で検証し `{ok:true, state}` か `{ok:false, reason}` を返す。

| reason | 条件 | 扱い |
|---|---|---|
| `parse` | JSON として壊れている | 拒否（ひらがなエラー表示） |
| `marker` | `app !== 'piano-pet'`（別アプリ・マーカー無し） | 拒否 |
| `shape` | 必須キー `state.pet` / `state.streak` が欠落 | 拒否（クラッシュ防止の最小スキーマ検証） |
| `future` | `schemaVersion` が現行 `SCHEMA_VERSION` より大きい | 拒否（ダウングレード破損防止） |

検証を通った場合のみ `migrate()` → `normalizeState()` を適用して現行スキーマに整える（過去バージョンは migrate で引き上げ）。

### 復元フローとクラウド整合（重要）

`importState` は明示的な上書き操作。realtime 購読中に取り込むと、push が Firestore に反映される前に
**古いスナップショットが `onSnapshot` 経由で降ってきて取り込み結果を巻き戻す競合**が起きうる。これを断つため
app.js の復元フローは次の順で行う（設計レビュー topic_1780530736889 で合意）:

1. 復元直前の現行 localStorage を `piano-pet-backup-before-restore`（`RESTORE_BACKUP_KEY`）へ自動退避（誤読込からの復旧用）。
2. 保持しておいた cloud 購読解除ハンドル（`cloudUnsub`）を実行して **onSnapshot を一時解除**。
3. `saveState(imported)` でローカル反映。
4. `await pushCloud(cloudFields(imported))` で**クラウド反映の完了を待つ**。
5. `window.location.reload()` でクリーン再起動。リロード後の `fetchCloud()` は push 済みの取り込み済みデータを返すため巻き戻しは起きない。

> **設計判断**: 購読を解除せず差分比較だけに頼ると、import 直後の旧スナップショットが `mergeCloud` で取り込み結果を上書きしうる。`cloudUnsub` の保持＋push 完了待ち＋reload の三段で競合を物理的に排除する。オフライン時は `pushCloud` が早期 return するが、ローカルには取り込み済みが残り次回オンライン同期で送られる。

### 子の誤操作防止（ペアレンタルゲート）

設定は専用ナビ画面を増やさず、ホームヘッダの ⚙️ ボタン → オーバーレイで提供する。子が面白がって
開くのを防ぐため、オーバーレイは簡単な掛け算（1桁×1桁の九九・`makeGateProblem`）の正解時のみメニューを開く。
保存（export）は無害なので確認なし、読み込み（import）は上書き確認ダイアログを挟む。

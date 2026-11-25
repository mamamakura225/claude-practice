# データモデル（設計書）

> **スキーマ・マージ規則・永続化の正本**。要件は [requirements.md](./requirements.md)、画面とふるまいは [features.md](./features.md)、書き方と更新ルールは [README.md](./README.md)。

1. [保存の全体像](#1-保存の全体像)
2. [State スキーマ](#2-state-スキーマ-v2)
3. [派生データ（保存しない）](#3-派生データ保存しない)
4. [正規化と型の矯正](#4-正規化と型の矯正)
5. [マイグレーション](#5-マイグレーション)
6. [クラウド同期](#6-クラウド同期)
7. [がぞくコード（doc ID の推測不能化）](#7-がぞくコードdoc-id-の推測不能化233-段階1)
8. [バックアップ／復元・初期化](#8-バックアップ復元初期化)
9. [マルチアカウント](#9-マルチアカウントアカウント分離182)

## 1. 保存の全体像

| 置き場所 | 中身 | 実装 |
|---|---|---|
| localStorage（state） | State 全体を JSON で1キーに保存。キーは有効アカウントから導出（既定＝娘 `piano-pet`／テスト用 `piano-pet:test`・#182） | [storage.js](../js/storage.js)（キー導出は [account.js](../js/account.js) `storageKeyFor`） |
| localStorage（その他） | 端末ごとの印・設定・退避（[下表](#state-以外の-localstorage-キー)） | 各モジュール |
| Firestore `pianopet/<doc ID>` | State のうち `CLOUD_FIELDS` だけ | [cloud.js](../js/cloud.js)（doc ID は [account.js](../js/account.js) `cloudDocIdFor`） |

- 読み込み・正規化・クラウド射影は [storage.js](../js/storage.js) に集約する
- `CLOUD_FIELDS` ＝ `pet, inventory, streak, badges, sessions, deletedDates`。`settings` と `version` は端末ローカル
- `saveState` は書けなくても（容量超過等）投げず `false` を返す（#428）。画面とクラウド送信は続き、毎回 state 全体を書くので次の保存が通れば追いつく。失敗中は知らせを出し、スタンプ下書きを消さない

### State 以外の localStorage キー

いずれもクラウドへは載せない。

| キー | 値 | 用途 |
|---|---|---|
| `piano-pet-onboarded` | `'1'` | 初回オンボーディング（#141）を見たか。アカウント横断 |
| `piano-pet:accounts` | `{ active, accounts: [{id,name}] }` | 有効アカウントと一覧（#182）。壊れていれば既定2アカウントに戻す |
| `piano-pet:cloud-ids` | `{ [アカウントID]: コード }` | がぞくコード（#233・[7章](#7-がぞくコードdoc-id-の推測不能化233-段階1)） |
| `piano-pet-backup-before-restore` | State JSON | 復元・初期化の直前の自動退避（#140 #183） |
| `piano-pet-backup-before-restore:meta` | `{account, doc, at}` | 上の退避の素性（#398） |
| `piano-pet-backup-before-migrate` | State JSON | がぞくコードへの移行直前の自動退避（#233） |
| `pp-theme` | `'light'` \| `'dark'` \| `'auto'` | 画面のあかるさ（#151） |
| `<アカウントキー>:stamp-draft` | `{ date, stamps: string[] }` | 当日のスタンプ下書き（#164・[下記](#スタンプ下書きstamp-draft)） |

#### スタンプ下書き（stamp-draft）

- ホームと往復してもスタンプカードを引き継ぐための一時保存（#164）。打鍵ごとに保存する（Firestore へは送らない）
- **初回の記録前だけ使う**。記録後は当日の Session から復元する（#186）
- `date !== todayStr()` なら捨てる。編集中と、ひづけ欄が今日以外のあいだは書き込まない（#273）
- **当日の Session があるあいだは保存せず消す**。復元・初期化でも消す（#428）。残すと、その記録を別の日へ動かした・他端末で消したときに古い回数が戻り、二重に記録される

## 2. State スキーマ (v2)

| フィールド | 型 | 同期 | 説明 |
|---|---|:---:|---|
| `version` | number | − | スキーマバージョン。現行 `2` |
| `pet` | [Pet](#pet) | ✓ | ペット本体と、pet 配下にまとめた機能データ |
| `inventory` | string[] | ✓ | 購入済みショップアイテムID |
| `streak` | [Streak](#streak--settings) | ✓ | 連続練習 |
| `badges` | string[] | ✓ | 獲得バッジID |
| `sessions` | [Session](#session)[] | ✓ | 練習記録。XP・レベル・コイン・連続日数・バッジの**唯一の計算元** |
| `deletedDates` | string[] | ✓ | 削除した記録の日付の墓標（#319・[下記](#削除の墓標-deleteddates319)） |
| `settings` | [Settings](#streak--settings) | − | 端末ローカル設定 |

- 削除済みの `assignment`（しゅくだい・#143 → #261）は、既存データに残っていても未知キーとして無害に引き継がれる

### Session

1件 ＝ ある日付の練習記録。生成は [game.js](../js/game.js) `applySession`、曲の集約は [record-form.js](../js/record-form.js) `collectSongs`。

| フィールド | 型 | 種類 | 説明 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | 主キー | 練習したローカル暦日。**同じ日は1件**に統合する（`mergeSameDaySessions`） |
| `songs` | `{ name, count }[]` | 入力 | 曲ごとの回数。空名・0回以下は除外済み |
| `totalCount` | number | 入力 | その日の合計回数 |
| `coinsEarned` | number | 導出 | その記録の**基本**コイン（`calcRewards`）。おまけ・レッスン日は含まない |
| `xpEarned` | number | 導出 | その記録の XP |
| `bonusCoins` | number | 付与 | きょうのおまけ（#148）で当たったコイン。0＝外れ |
| `praise` | string \| null | 付与 | はなまる（#145）。`hanamaru`/`jouzu`/`ganbatta`。表示時に `normalizePraise` で検証 |
| `tempo` | string \| null | 付与 | 練習の質メモ（#239）。`slow`/`normal`/`fast`。`normalizeTempo` で検証。自由記述は持たない（PII規約） |

> ⚠️ **sessions を書き換える処理は必ず `recomputeState` を通す**（付与の `praise`/`tempo` を除く）。`recomputeState` は sessions と `pet.lessonDates`（#393）だけから全状態を作り直す。

**設計判断**

- **「導出」と「付与」に分ける（#315）**：導出は作り直せるが、付与は失うと戻せない。付与は同日統合（`mergeSameDaySessions`）と端末間マージ（`mergeSessionsKeepLarger`）のどちらでも「どちらかに付いていれば残す」（両側に別値なら先勝ち）。フィールドを足すときは、まずどちらかを決める
- **おまけコインは記録に焼き込む（#148）**：派生値に足すだけでは再計算で消える。抽選は app.js がその日の初回記録だけで行い、`recomputeState` は `bonusCoins` を足し戻すだけ（`game.js` に乱数を持ち込まない）
- **同日1件は `recomputeState` が入口で保証する（#316）**：realtime の取り込みは同日重複を持ち込みうる。重複のまま再生すると素点・連続ボーナス・お休み券が二重になる。取り込み経路ごとに dedup を足すと、経路が増えるたびに漏れる

### Pet

`pet` 配下は `CLOUD_FIELDS` にまとめて載る（realtime は pet ごと cloud-wins、初回マージは[規則表](#63-初回取り込みのマージmergecloudinitialローカル優先)）。

| フィールド | 型 | 既定 | 説明 |
|---|---|---|---|
| `name` | string | `'きーちゃん'` | 猫の名前 |
| `level` / `xp` | number | `1` / `0` | XP から出す現在レベル／累計 XP |
| `coins` | number | `0` | 所持コイン（[下記](#所持コインの導出)） |
| `equippedItems` | string[] | `[]` | 装備中の装着アイテム（スロットごとに1つ） |
| `placedItems` | string[] | `[]` | 配置中の置物（#226）。排他なしに複数置ける |
| `itemLayout` | object | `{}` | 装着・置物の自由配置 `{ [id]: { x_pct, y_pct, scale?, layer? } }`（#168 #205 #226 #270）。.cat 正方枠の%、`scale` は絶対値、`layer` は `'front'`/`'back'`。キーが無ければ既定 |
| `affinity` | number | `0` | なかよし度（えさやりで上がる） |
| `foodSpent` | number | `0` | えさに使ったコインの総額 |
| `dailyGoal` | number | `10` | 1日の目標回数（#238）。5〜20（`clampDailyGoal`）。達成ボーナスの閾値（`GOAL_BONUS_THRESHOLD=10`）とは別 |
| `catStyle` | string | `'tora'` | 猫スタイル（#66）：`tora`/`shiro`/`russianblue`。未知値は `normalizeStyle` が tora に戻す |
| `childName` | string | `''` | こどもの名前（#121）。12文字まで（`normalizeChildName`）。**analytics に送らない** |
| `childAvatar` | string | `'chick'` | こどものアイコンID（#121・`CHILD_AVATARS`）。未知は 🐥 |
| `lessonDates` | string[] | `[]` | レッスン日（#393）。昇順・重複なし（`normalizeLessonDates`）。**analytics に送らない**。仕様は [features.md](./features.md#レッスン日393) |
| `lessonRemoved` | string[] | `[]` | 解除したレッスン日の墓標（#393）。再登録すると外す |
| `stampBook` | object | `{ card: null, pressed: [], done: [] }` | ねこスタンプちょう（#409・[下記](#stampbook409)） |

#### 所持コインの導出

- `coins = Math.max(0, 獲得総額 − spent)`。`recomputeState` が毎回この式で出し直す
- `spent` ＝ `spentCoins`（所持アイテムの**現行価格**の合計）＋ `foodSpent`。[app.js](../js/app.js) `spentTotal` が計算して渡す
- 価格を変えると既存ユーザーの残高が動く（→ [features.md の #250](./features.md#購入とコイン)）

#### stampBook（#409）

| キー | 内容 |
|---|---|
| `card` | いまのカード `{ id, startDate, size, reward, emoji }` か `null`。`id` は作成時刻 ms、`size` は 5〜60、`reward` は20文字まで |
| `pressed` | 子が押した日（`YYYY-MM-DD` の昇順） |
| `done` | ごほうびを あげた カード。`card` の項目＋`dates`（その時点のスタンプの日付）＋`redeemedOn` |

- ごほうびの文字は analytics に送らない。仕様と設計判断は [features.md](./features.md#ねこスタンプちょう409)

### Streak / Settings

| Streak | 型 | 既定 | 説明 |
|---|---|---|---|
| `current` / `best` | number | `0` | いまの連続日数／最高記録 |
| `lastPracticeDate` | `YYYY-MM-DD` \| null | `null` | 最後に練習した日 |
| `freezes` | number | `0` | お休み券の枚数（上限2） |

| Settings | 型 | 既定 | 説明 |
|---|---|---|---|
| `soundOn` | boolean | `true` | 音の ON/OFF |

- `updateStreak` の戻り値の `frozeDays`（何日ぶん救済したか）はポップアップ用の一時値で、**保存しない**

### 削除の墓標 deletedDates（#319）

- 削除した記録の日付と、「なおす」で日付を動かしたときの**元の日付**（#358）を積む
- 同じ日に再記録すると外れる（`applySession`/`recomputeState`）。剪定しない（1年で約 3.6 KiB）

**設計判断**

- sessions のマージは日付の union なので、墓標が無いと削除を受けていない端末の古いコピーから復活する
- 記録ID／vector clock は不採用（マージ規則全体の書き直しになる）。同日1件の不変条件を主キーに使う
- **`SCHEMA_VERSION` は上げない**：無ければ `normalizeState` の既定値 `[]` で足りる

## 3. 派生データ（保存しない）

毎回導出する。**解放済みフラグ類を持たない**のは、二重管理が `recomputeState` との不整合の元になるため。

| 派生値 | 導出元 | 実装 |
|---|---|---|
| 曲の色（#122） | 曲名のハッシュ | [song-color.js](../js/song-color.js) `songColor` |
| 曲別の累計回数（#122） | `sessions` | [record-form.js](../js/record-form.js) `songTotals` |
| 曲マスター👑（#149） | 累計 ≥ `SONG_MASTER_COUNT`(=50) | `isSongMaster` |
| なかよしレベルとご褒美（#124） | `pet.affinity` | [feed.js](../js/feed.js) `affinityLevel` / `affinityRewards` |
| きせかえの購入解放（#126） | なかよしレベル ≥ `unlockLevel` | [shop.js](../js/shop.js) `isUnlocked`（購入時だけ判定） |
| 月間カレンダー（#236） | `sessions` の日別集計 | [history.js](../js/history.js) `monthGrid`/`heatLevel`/`dailyCountMap` |
| スタンプの「もらえる日」と絵柄（#409） | `sessions` の日別合計・カード・日付 | [stamp-book.js](../js/stamp-book.js) `eligibleDates`/`cardStatus`/`designForDate` |

## 4. 正規化と型の矯正

`normalizeState(saved)` は全経路（localStorage・Firestore・バックアップ）が通る**唯一の入口ガード**（#272）。

- 不足キーを `DEFAULTS` で補う。フィールド追加程度ならスキーマバージョンは上げない
- 未知のトップレベルキーはそのまま引き継ぐ

### 型の矯正（#272）

| 対象 | 矯正 |
|---|---|
| `saved` 自体 | プレーンオブジェクトでなければ `DEFAULTS` |
| `pet` / `streak` / `settings` / `pet.itemLayout` | プレーンオブジェクトでなければ既定（配列も弾く） |
| `pet` の `level`/`xp`/`coins`/`affinity`/`foodSpent`・`streak` の `current`/`best`/`freezes`（#428） | 有限の数値にする（`asNumber`）。できなければ既定。`affinity`/`foodSpent` は 0 以上 |
| `pet.itemLayout` の各エントリ（#428） | 数値でない座標・正の数値でない `scale`・未知の `layer` を落とす |
| `streak.lastPracticeDate`（#428） | 実在する日付でなければ `null` |
| `sessions` / `inventory` / `badges` / `pet.equippedItems` / `pet.placedItems` | 配列でなければ空配列 |
| `deletedDates` / `pet.lessonDates` / `pet.lessonRemoved` | 実在する `YYYY-MM-DD` だけ残し重複を除く |
| `sessions` の各要素 | プレーンオブジェクトでない要素を除く |
| `sessions[].date`（#311） | 実在する `YYYY-MM-DD` でなければ**要素ごと落とす**（件数を `console.warn`） |
| `sessions[].totalCount`（#311）・`bonusCoins`（あれば・#428） | 有限の数値にする。できなければ 0 |
| `sessions[].songs`（#311） | 配列でなければ空配列。各要素を `{ name: String, count: Number }` にし、`name` が空の曲は除く |
| `pet.stampBook`（#409） | カードは `id` が数値でない／`startDate` が日付でなければ**捨てる**。`size` は 5〜60、`reward` は20文字へ丸める。`pressed`・`dates` は日付だけ残す。`emoji` は8文字までで保存し、表示時に候補8種以外を🎁にする |

- 日付は実在するものだけ通す（`isDate`）

**設計判断**

- **信頼できない入力として扱う（#272）**：認証なしの Firestore doc（#258）とバックアップ JSON も入力元。型の不正が通ると app.js のモジュールトップが throw して**画面が真っ白**になり、localStorage に残るのでリロードでも直らない
- **落とすか直すかは値の性質で決める（#311）**：`date` と stampBook の `startDate` は既定値では捏造になるので落とす。`totalCount` / `songs` は安全な既定値があるので直して残す。多層防御として `checkBadges` でも `totalCount` を `Number()` で守る
- **中身まで矯正する（#428）**：`2026-11-00` は `recomputeState` を RangeError にして記録の保存ごと止め、文字列の `scale` は起動時の描画を落とし、文字列の数値は加算を連結（`'5'+1`）に化けさせる
- **バックアップは矯正ではなく拒否する**：黙って空配列に直すと、**壊れた記録が消えたことに親が気づけない**

## 5. マイグレーション

| 要素 | 内容 |
|---|---|
| `SCHEMA_VERSION` | 現行 `2`。state の `version` に保存する |
| `MIGRATIONS[n]` | v(n) を v(n+1) の形へ変える純粋関数。現行の2つ（v0→v1、v1→v2＝`pet.itemLayout` #168）はどちらも構造変換なし |
| `migrate(saved)` | 順に上げる。`version` 無しは **v0**。現行より新しいものはそのまま返す |
| 読み込み順 | `loadState()` → `migrate()` → `normalizeState()` |

**破壊的な変更（削除・改名・構造変更）を入れる手順**

1. `DEFAULTS` を更新し、`SCHEMA_VERSION` を +1 する
2. `MIGRATIONS` の末尾に変換関数を足す（入力を壊さない。`version` の付与は `migrate()` が行う）
3. `tests/storage.test.js` に移行テストを足し、本書を更新する

> ⚠️ **クラウド側の制約**：Firestore のデータに `version` は無い。`mergeCloud(local, cloud)` は `migrate()` を通さないので、**同期対象の構造を破壊的に変えるときは `mergeCloud` の中でも移行を通すこと**。

## 6. クラウド同期

### 6.1 起動シーケンス（ローカルファースト・#142）

1. `loadState()` → `renderHome()` を**同期で**実行する。最初の描画はクラウドを待たない
2. `initCloudSync` は `requestIdleCallback`（非対応なら `setTimeout`）で**アイドルまで遅らせる**。Firebase SDK はここで動的 import する
3. SDK が取れなくてもローカル動作は止めない（`online` 復帰で再試行）
4. `fetchCloud`（上限5秒）は「doc が無い（`null`）」と「取れなかった（`undefined`）」を分けて返す（#362）

| `fetchCloud` の結果 | 動作 |
|---|---|
| doc あり | 初回取り込み（`reconcileInitialCloud`・union）→ 差分があれば push |
| `null`（doc 無し） | ローカルにデータがあるとき（`hasLocalData`）だけ丸ごと送る（初回移行） |
| `undefined`（取れなかった） | 何も送らない。印（`offlineDirty`）を立て、最初のスナップショットを union で取り込む。30秒ごとに resync を取り直す（`retryResync`・#374） |

- どの場合も、そのあと `initialSyncDone` を立てて `subscribeCloud` で購読を始める（上書き中に返った取得は捨てて購読もしない・[8章](#8-バックアップ復元初期化)）

**設計判断**

- **取れなかったときは送らない（#362）**：タイムアウトも `null` 扱いにすると、遅い回線の起動で `setDoc` 全置換し他端末の記録を消す。最初のスナップショットを cloud-wins にするとローカルだけの記録が消えるので union に倒す
- **30秒ごとの取り直し（#374）**：doc が本当に無い場合はスナップショットが来ないため。予約は1つのタイマーにまとめ、オンラインの間だけ回す
- **初回移行の `pushCloud` は ack を待たない**：待つ間の変更が積まれも印も立たないまま、最初のスナップショットの cloud-wins で**記録が消える**（実測）。Firestore は書き込みをローカルへ即時反映するので待つ必要が無い

### 6.2 取り込み経路は3つあり、規則が同じではない

**平常時の realtime だけ cloud-wins、残り2つは union（ローカル優先）**。

| 経路 | 契機 | 規則 | 失われうるもの |
|---|---|---|---|
| 初回取り込み | 起動後 idle の `fetchCloud`（1回） | `mergeCloudInitial`＝フィールド別にローカル優先（union） | 同日衝突で回数の**少ない方** |
| 復帰時 resync（#242 #358） | `visibilitychange`→visible、`online` 復帰 | 同上（`reconcileInitialCloud`） | 同上。加えて**一方で外した装備・置物が戻る**ことがある |
| realtime | `onSnapshot`（以降ずっと） | `applyRemoteState` → `mergeCloud`＝**cloud-wins**（`CLOUD_FIELDS` をまるごと差し替え）。自分のエコーはキー順をそろえた差分比較（`cloudDigest`・#428）でスキップ。`deletedDates` だけは union し、墓標の日付の記録は取り込まない（#319）。**印（`offlineDirty`）が立っている間は union**（#358） | **まだ送っていないローカルの変更**（debounce の待ち・既定2秒） |

**設計判断**

- **realtime は cloud-wins**：union だと、一方で外した装備が相手のスナップショットのたびに戻る。記録の確定は `flushCloud()` で即送るので落ちない。フィールド別の世代管理は #258 と合わせて別途
- **初回と復帰時だけ union**：初回に cloud-wins を使うと、idle 同期の前の記録を上書きする
- **復帰時は fetch して union（#242）**：サスペンド中は `onSnapshot` が届かない。古い state のまま操作すると、`setDoc`（doc 丸ごと置換）で**他端末が置いた置物が消える**
- **オフライン復帰は push ではなく resync（#358）**：無条件に push すると、オフライン中に他端末が確定した記録を消す
- **SDK にオフライン書き込みを積ませる案は不採用**：再接続時に `setDoc` 全置換が送られ、他端末の記録を消す
- **既知の制限**：起動後にいったん取り込めた端末が、`navigator.onLine === true` のまま不通の回線へ移ると印が立たず、SDK がメモリに積んだ `setDoc` 全置換を再接続時に送る

**印（`offlineDirty`）の上げ下げ（#358 #362 #374）**

| | 契機 |
|---|---|
| 立てる | オフライン中の変更（`queueCloudPush`）／`offline` イベント／初回 `fetchCloud` が取れなかったとき |
| 下ろす | resync が取れて（doc 無し＝`null` を含む）、かつその時点でオンライン（`resyncAndSettle`）／オンラインで届いたスナップショットを union で取り込んだとき |
| 下ろさない | 取れなかった（`undefined`）とき／fetch を待つ間に再びオフラインになったとき |

### 6.3 初回取り込みのマージ（mergeCloudInitial＝ローカル優先）

`mergeCloudInitial(local, cloud)` のあと `recomputeState` で導出値を出し直し、結果がクラウドと違えば `pushCloud` で確定する。

| フィールド | 規則 | 理由 |
|---|---|---|
| `sessions` | `mergeSessionsKeepLarger`：日付で1日1件。両側にあれば `totalCount` の**大きい方**（**合算しない**）、同回数ならローカル。並びは日付の降順。付与値は「どちらかに付いていれば残す」（`bonusCoins` は大きい方・#315）。`deletedDates` の日付は除く | 合算すると部分同期後の共有ぶんを二重に数える |
| `deletedDates` | **union**（#319） | 片方で消したものは消えたまま |
| `inventory` | **union** | 所有は増える一方 |
| `pet.equippedItems` / `pet.placedItems` | union のうち、マージ後の `inventory` にあるものだけ（#226） | 持っていない装備・配置を残さない |
| `pet.itemLayout` | **union**（クラウドを土台にローカルで上書き・#242） | 他端末で置いた置物が既定位置へ戻らないように |
| `pet.affinity` / `pet.foodSpent` | **max** | sessions から導出できない累積値 |
| `pet.lessonDates` / `pet.lessonRemoved` | 「登録の union − 墓標の union」／墓標は union（`mergeLessonDates`・#393） | 解除した登録が他端末から戻らないように |
| `pet.stampBook`（#409） | `done` は `id` で union、`pressed` は union。`card` は相手側で `done` なら捨て、両側にあれば `id` の新しい方、同じ `id` ならローカル | 押した・あげた は取り消さない操作。終わったカードを戻すと同じごほうびを二度もらう |
| 上記以外の `pet`（`name`/`dailyGoal`/`catStyle`/`childName`/`childAvatar`）・`settings` | **ローカル** | — |
| `pet.coins`/`xp`/`level`・`streak`・`badges` | `recomputeState` で出し直す | sessions が唯一の正 |

**設計判断（topic_1780534255497）**：同日衝突は **keep-larger**。水増しは取り消せず気づきにくいので、無損失（合算）より優先した。合算するには記録ID か vector clock が要る。

### 6.4 書き込み（遅延バッチ・#146）

`commitState` はローカルへ即保存し、クラウドへは `pushCloudDebounced`（既定 2000ms）で送る。待ちの間の連続操作を**1回の書き込みにまとめる**。

| 契機 | 動作 |
|---|---|
| 記録の確定（`submitRecord`） | 直後に `flushCloud()` で即送る |
| `visibilitychange`→hidden／`pagehide` | `flushCloud()` で保留分を確定する |
| オフライン中 | `flushCloud()` は保留を消さずに持つ（#288） |
| `initialSyncDone` 前／印が立っている間 | `queueCloudPush` は**何も積まない**（#374）。次の union 取り込みが差分を送る |
| レッスン日の解除（取り消しの猶予・#398） | `holdCloudPush` で猶予（5秒）より長く待つ |
| 明示的な上書き（復元・初期化・がぞくコード移行） | `queueCloudPush` を通らず即 push（[8章](#8-バックアップ復元初期化)） |

- キューの実体は firebase に依存しない [cloud-queue.js](../js/cloud-queue.js)（単体テストできるよう `cloud.js` から分けた）

**設計判断**

- **保留は値ではなく thunk で持つ（#313）**：`() => cloudFields(state)` で送る時点の state を読む。値で焼き付けると、保留中に届いた**他端末の確定済み記録を巻き戻す**。「保留中に state が変わったら捨てる」方式は、経路が増えるたびに漏れる。thunk は印を見て `null` を返し、キューは送らない
- **`initialSyncDone` は `cloudSynced`（import 成功）と別のフラグ（#313）**：`fetchCloud` を待つ間の `online` で、マージ前のローカルを送らない
- **取り込む前は送らない（#374）**：不通の回線で SDK が積んだ `setDoc` 全置換が、再接続時に他端末の記録を消しえた。キュー側で保留する案は判断が2か所に分かれるので不採用。**送るのは union 取り込みの1箇所だけ**に揃える
- **既知の制限**：取得待ち・取得失敗の間に外した装備・置物は、クラウドに残っていれば union で戻る

## 7. がぞくコード（doc ID の推測不能化・#233 段階1）

旧 doc ID は固定（`pianopet/data`／`pianopet/test`）で、Firebase config は公開情報なので**第三者が到達できる**。初回に作るランダム値（**がぞくコード** `pp-<uuid>`）へ置き換える。

| 項目 | 内容 |
|---|---|
| 保存 | 端末ローカル `piano-pet:cloud-ids`（アカウント単位）。**クラウドには載せない** |
| 移行前 | `cloudDocIdFor` は旧固定IDを返す |
| 移行（親ゲート内の明示操作） | ①ローカルへ自動退避（`piano-pet-backup-before-migrate`）②コードを作る ③新 doc へコピー ④コードを保存 ⑤リロード |
| 他の端末 | **コードを入力**するか、コード入りのバックアップJSON（#140）で合流する。入力した場合の初回同期は union |
| 旧 doc | 全端末の合流後に親が「ふるい ばしょを からにする」で空にする |

**設計判断**

- **自動移行にしない**：端末ごとに別のコードができると家族の共有 doc が割れる
- **旧 doc に転送先を書き置かない**：旧IDを知る第三者が新IDへ届く。コードは**帯域外（画面表示／バックアップJSON）**で共有する
- **匿名認証＋セキュリティルールは段階2（#258）**：匿名 UID は端末ごとに違い、複数端末の共有が壊れる。クレデンシャルの引き継ぎか実アカウント認証の設計が別に要る
- セキュリティルールは間借り元 `dtask-d08b6` の Firebase コンソールで管理している（リポジトリ外・dtask にも影響）

## 8. バックアップ／復元・初期化

親が JSON で手元に保存し、いつでも戻せるようにする安全弁（[backup.js](../js/backup.js)・#140 #183）。UI は [features.md](./features.md#せってい親ゲートの内側)。

### ファイル形式

`piano-pet-backup-YYYY-MM-DD.json`（`exportState(state)`）。

```json
{
  "app": "piano-pet",
  "schemaVersion": 2,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "cloudDocId": "pp-xxxxxxxx", /* 任意。がぞくコード移行済みのときだけ入る */
  "state": { /* loadState() と同じ state オブジェクト（version 含む） */ }
}
```

### 読み込み時の検証（parseBackup）

`{ok:true, state, cloudDocId}` か `{ok:false, reason}` を返す（`cloudDocId` は形式が正しいときだけ非 null）。通ったら `migrate()` → `normalizeState()` で整える。

| reason | 条件 |
|---|---|
| `parse` | JSON として壊れている |
| `marker` | `app !== 'piano-pet'` |
| `shape` | `state.pet` / `state.streak` が無い・配列／`sessions`・`inventory`・`badges` が配列でない（#272） |
| `future` | `schemaVersion` が現行より大きい |

### 上書きの手順（復元・初期化で共通）

購読中に取り込むと、push が届く前に**古いスナップショットが結果を巻き戻す**ので、次の順で行う（`applyImportedState`・topic_1780530736889）。

1. 今の localStorage を `piano-pet-backup-before-restore` へ退避する
2. `saveState(imported)` でローカルに反映する。**書けなければ（容量超過等）何も変えずに知らせてやめる**（退避も元に戻す・#428。クラウドやがぞくコードだけ入れ替わるのを防ぐ）
3. 購読解除（`cloudUnsub`）で **onSnapshot を止める**。復帰時 resync と30秒の再試行も止める（`stopCloudForOverwrite`・#378）。がぞくコードの切替とスタンプ下書きの消去もここ
4. `await pushCloud(cloudFields(imported))`（**上限10秒**・`pushForOverwrite`・#381）。がぞくコード入りのファイルは `pushCloudDoc(コード, …)` でそのコードの doc へ書く（#358）
5. `window.location.reload()`

- **初期化（`resetData`・#183）**は取り込み対象が `normalizeState({})` になるだけ。`settings` 等の端末ローカル値も既定へ戻る
- オフラインのときは push せずに reload する。クラウドは置き換わらず、次の初回同期は union になる＝**「置き換え」が「マージ」に弱まる**

**設計判断**

- **がぞくコード入りの復元は `pushCloudDoc`（#358）**：`cloud.js` の `DATA_DOC` は import 時点の doc に固定される。`pushCloud` だと空にした旧 doc へ書き戻す
- **上書き中は他の経路を止める（#378）**：ack を待つ間に先行の取得が返ると、上書き前のクラウドと union した state が後から送られ、消したはずの記録が戻る。`overwriting` で止めるのは次の4つ（リロードで張り直されるので下ろさない）
  1. `reconcileInitialCloud`
  2. resync の取り込みと初回移行
  3. 起動直後の初回取得（返ったら捨て、購読も張らない）
  4. debounce の保留（thunk が `null` を返す。送り先が切替前の旧 doc のため）
- **ack は10秒で見切る（#381）**：`navigator.onLine` が true のまま不通の回線では `setDoc` が解決せず、reload へ進まない。`fetchCloud` の5秒より長いのは、短いほど上書きが弱まるため
  - 見切ったときの帰結：未送信の書き込みはリロードで捨てられ、次の初回同期は union。**復元は「マージ」に弱まり、初期化は実質取り消し**（ローカルは退避済み）。送信済みなら「置き換え」になる
  - **届かなかったら親に伝える（#384）**：見切り・送信失敗・オフラインのときは `piano-pet:overwrite-unsent` に印を残し、次の起動で一度だけ案内する（reload 前に出すと無反応の時間が延びる）
  - 不採用：次回起動で置き換えを再送する案。古い意図で、その後に他端末が記録したデータまで消しうる
  - 同じ上限（`withinLimit`）を「あんぜんな ばしょに うつす」「ふるい ばしょを からにする」にも掛ける
- **初期化は UI で行う（#183）**：Firestore を直接消す案は、親が端末だけで完結できないので不採用

## 9. マルチアカウント（アカウント分離・#182）

検証用と実運用でデータを分ける。認証は入れず、**Firestore doc と localStorage キーをアカウント単位で名前空間化する**（[account.js](../js/account.js)）。

| 項目 | 内容 |
|---|---|
| 既定アカウント | 娘（`id: 'data'`）／テスト用（`id: 'test'`） |
| 名前空間 | localStorage は `storageKeyFor(id)`、Firestore doc は `cloudDocIdFor(id)`。`data` は従来の保存先（`piano-pet`・`pianopet/data`）を指す |
| 切替 | 親ゲートの奥で `setActiveAccount(id)` → リロード（`cloud.js` は doc を import 時に固定する） |

**設計判断**

- Firebase 認証で `users/{uid}` の下に置く案は、共有プロジェクト（`dtask-d08b6`）とデータ構造への影響が大きく不採用。**家庭内ツール前提**で、子の切替は親ゲートで防ぐ
- **前提（Firestore ルール）**：`pianopet` コレクション全体（doc ワイルドカード）を許可していること。`pianopet/data` 限定だと、それ以外の doc への書き込みが拒否されローカルのみで動く（`pushCloud` は失敗を握りつぶす）

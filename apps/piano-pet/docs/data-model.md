# データモデル（設計書）

> **スキーマ・マージ規則・永続化の正本**。要件は [requirements.md](./requirements.md)、画面とふるまいは [features.md](./features.md)。
> **更新ルール**: `apps/piano-pet/` のソースを変えたら、同じPRで関連docsへ反映する（[CLAUDE.md](../../../CLAUDE.md)）。

**この文書の構成**

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
- `CLOUD_FIELDS` ＝ `pet, inventory, streak, badges, sessions, deletedDates`。`settings` と `version` は端末ローカルに留まる

### State 以外の localStorage キー

いずれも端末ローカルでクラウドへは載せない。

| キー | 値 | 用途 |
|---|---|---|
| `piano-pet-onboarded` | `'1'` | 初回オンボーディング（#141）を見たか。端末ごとに案内するので state に入れない。アカウント横断（[onboarding.js](../js/onboarding.js)） |
| `piano-pet:accounts` | `{ active, accounts: [{id,name}] }` | 有効アカウントと一覧（#182・[account.js](../js/account.js)）。壊れていれば既定2アカウントに戻す |
| `piano-pet:cloud-ids` | `{ [アカウントID]: コード }` | がぞくコード（#233・[7章](#7-がぞくコードdoc-id-の推測不能化233-段階1)） |
| `piano-pet-backup-before-restore` | State JSON | 復元・初期化の直前の自動退避（`RESTORE_BACKUP_KEY`・#140 #183） |
| `piano-pet-backup-before-restore:meta` | `{account, doc, at}` | 上の退避の素性。「ひとつ まえの データに もどす」はアカウントとがぞくコードが今と一致するときだけ出す（#398） |
| `piano-pet-backup-before-migrate` | State JSON | がぞくコードへの移行直前の自動退避（#233） |
| `pp-theme` | `'light'` \| `'dark'` | 画面のあかるさ（#151）。`auto` は保存しない |
| `<アカウントキー>:stamp-draft` | `{ date, stamps: string[] }` | 当日のスタンプ下書き（#164・[下記](#スタンプ下書きstamp-draft)） |

#### スタンプ下書き（stamp-draft）

- ホームへ戻って記録を再開してもスタンプカードを引き継ぐための一時保存（#164）。打鍵ごとに保存する
- **初回の記録前だけ使う**。記録を確定したあとは当日の Session が正で、記録画面は Session から復元する（#186）
- 読み出したとき `date !== todayStr()` なら捨てる
- 記録画面のひづけ欄が今日以外のあいだは書き込まない（過去日の入力で当日の下書きを潰さない・#273）
- アカウントごとに分かれる

## 2. State スキーマ (v2)

| フィールド | 型 | 同期 | 説明 |
|---|---|:---:|---|
| `version` | number | − | スキーマバージョン。現行 `2`（v1→v2 は `pet.itemLayout` の導入・#168） |
| `pet` | [Pet](#pet) | ✓ | ペット本体と、pet 配下にまとめた機能データ |
| `inventory` | string[] | ✓ | 購入済みショップアイテムID |
| `streak` | [Streak](#streak--settings) | ✓ | 連続練習 |
| `badges` | string[] | ✓ | 獲得バッジID |
| `sessions` | [Session](#session)[] | ✓ | 練習記録。XP・レベル・コイン・連続日数・バッジの**唯一の計算元** |
| `deletedDates` | string[] | ✓ | 削除した記録の日付の墓標（#319・[下記](#削除の墓標-deleteddates319)） |
| `settings` | [Settings](#streak--settings) | − | 端末ローカル設定 |

> **削除済み（#261）**：旧 `assignment`（しゅくだい・#143）は機能ごと削除し、同期対象から外した。既存データに残る値は `normalizeState` の未知キー引き継ぎで無害に残り、クラウド doc からは次の push（setDoc 置換）で消える。旧 `Assignment` スキーマ・LWW マージ（`pickNewerAssignment`）・関連 UI はコードから撤去済み。

### Session

1件 ＝ ある日付の練習記録。生成は [game.js](../js/game.js) `applySession`、曲の集約は [record-form.js](../js/record-form.js) `collectSongs`。

| フィールド | 型 | 種類 | 説明 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | 主キー | 練習したローカル暦日。**同じ日は1件**に統合する（`mergeSameDaySessions`） |
| `songs` | `{ name, count }[]` | 入力 | 曲ごとの回数。空名・0回以下は除外済み |
| `totalCount` | number | 入力 | その日の合計回数（`songs` の合計） |
| `coinsEarned` | number | 導出 | その記録の**基本**コイン（`calcRewards`）。再計算で毎回上書き。おまけは含まない |
| `xpEarned` | number | 導出 | その記録の XP（同上） |
| `bonusCoins` | number | 付与 | きょうのおまけ（#148）で当たったコイン。0＝外れ |
| `praise` | string \| null | 付与 | はなまるスタンプ（#145）。`PRAISE_STAMPS` の id（`hanamaru`/`jouzu`/`ganbatta`）。表示時に `normalizePraise` で検証 |
| `tempo` | string \| null | 付与 | 練習の質メモ（#239）。`TEMPO_STAMPS` の id（`slow`🐢/`normal`🎵/`fast`🚀）。`normalizeTempo` で検証。自由記述は持たない（PII規約） |

> ⚠️ **sessions が崩れると全部が崩れる**。sessions を書き換える処理を足すときは必ず `recomputeState` を通す。`recomputeState` は sessions と、練習した日として並べるレッスン日 `pet.lessonDates`（#393）だけから全状態を作り直す。

**設計判断**

- **フィールドは「導出」と「付与」の2種類に分ける（#315）**
  - 導出（`coinsEarned`/`xpEarned`）は `totalCount` から作り直せるので、統合規則を気にしなくてよい
  - 付与（`bonusCoins`/`praise`/`tempo`）は失うと戻せない。同日統合（`mergeSameDaySessions`）と端末間マージ（`mergeSessionsKeepLarger`）のどちらでも「どちらかに付いていれば残す」（両側に別値なら先勝ち）
  - フィールドを足すときは、まずどちらの種類かを決める
- **おまけコインは記録に焼き込む（#148）**：コインは `recomputeState` で全再計算される派生値なので、乱数ボーナスを足すだけでは再計算で消える。別のアキュムレータではなく記録の `bonusCoins` に保存した
  - 抽選は app.js（`rollDailyBonus(Math.random())`）がその日の初回記録だけで行い、`applySession(state, session, bonusCoins)` で記録へ入れる
  - `recomputeState` が `s.bonusCoins` を足し戻すので、編集・削除・マージ後も再抽選されない。`game.js` は純粋なまま（乱数は外から渡す）
- **同日1件は `recomputeState` が入口で自ら保証する（#316）**
  - realtime の取り込み（`applyRemoteState`）はクラウドの `sessions` をそのまま入れるので、旧版・手編集・破損 doc 由来の同日重複が届きうる
  - 重複のまま1件でも編集・削除すると、`recomputeState` が重複を再生して素点・連続ボーナス・お休み券を二重に数え、それが保存される
  - 取り込み経路（realtime／初回 reconcile／resync／バックアップ復元）は今後も増えるので、各経路に dedup を足すのではなく、依存する計算の入口で不変条件を保証する
  - 起動時の `migrate` 後の recompute は「保存データの是正」という別目的なので残す

### Pet

`pet` 配下は `CLOUD_FIELDS` にまとめて載るので、フィールドを足してもマージ規則の追加は要らない（realtime は pet ごと cloud-wins・初回マージは[規則表](#63-初回取り込みのマージmergecloudinitialローカル優先)）。

| フィールド | 型 | 既定 | 説明 |
|---|---|---|---|
| `name` | string | `'きーちゃん'` | 猫の名前 |
| `level` | number | `1` | XP から出す現在レベル |
| `xp` | number | `0` | 累計 XP |
| `coins` | number | `0` | 所持コイン（[下記](#所持コインの導出)） |
| `equippedItems` | string[] | `[]` | 装備中の装着アイテム（スロットごとに1つ） |
| `placedItems` | string[] | `[]` | 配置中の置物（#226）。装備とは別配列で、排他なしに複数置ける（`togglePlace`/`placeItem`/`unplaceItem`） |
| `itemLayout` | object | `{}` | 装着・置物の自由配置 `{ [id]: { x_pct, y_pct, scale?, layer? } }`（#168 #205 #226 #270）。.cat 正方枠の%。`scale` は絶対値、`layer` は `'front'`/`'back'`。キーが無ければ既定（位置＝アンカー／サイズ＝基準スケール／レイヤー＝装着は前面・置物は `SCENE_BOX[id].layer`）。外したアイテムは `cleanItemLayout` が掃除する |
| `affinity` | number | `0` | なかよし度（えさやりで上がる）。3段階の tier に集約して猫の表情・ポーズに出す（#167） |
| `foodSpent` | number | `0` | えさに使ったコインの総額 |
| `dailyGoal` | number | `10` | 1日の目標回数（#238）。5〜20（`clampDailyGoal`）。ホームの進捗とスタンプのマス数・音程だけに効く。達成ボーナスの閾値（`GOAL_BONUS_THRESHOLD=10`）とは別 |
| `catStyle` | string | `'tora'` | 猫スタイル（#66）：`tora`/`shiro`/`russianblue`。未知値は表示側（`normalizeStyle`）が tora に戻す |
| `childName` | string | `''` | こどもの名前（#121）。前後空白を落として12文字まで（`normalizeChildName`）。空なら名前を出さない。**analytics に送らない** |
| `childAvatar` | string | `'chick'` | こどものアイコンID（#121・[child-profile.js](../js/child-profile.js) `CHILD_AVATARS`）。未知は `normalizeChildAvatar` が 🐥 に戻す。顔写真は使わない |
| `lessonDates` | string[] | `[]` | レッスン日（#393）。`YYYY-MM-DD` の昇順・重複なし（`normalizeLessonDates`）。`sessions` には入れず、`recomputeState` が今日以前の登録日を練習記録と日付順に並べて再生する（連続+1・コイン `LESSON_COINS`/XP `LESSON_XP`）。**analytics に送らない**（通っている曜日のパターンになる）。設計判断は [features.md](./features.md#レッスン日393) |
| `lessonRemoved` | string[] | `[]` | 解除したレッスン日の墓標（#393）。初回マージで他端末の古い登録を復活させないため。再登録すると外す |
| `stampBook` | object | `{ card: null, pressed: [], done: [] }` | ねこスタンプちょう（#409・[下記](#stampbook409)） |

#### 所持コインの導出

- `coins = Math.max(0, 獲得総額 − spent)`。`recomputeState` が毎回この式で出し直す
- `spent` ＝ `spentCoins`（所持アイテムの価格合計）＋ `foodSpent`。[app.js](../js/app.js) が計算して渡す（購入・えさの消費分が再計算で復活しない）
- **`spentCoins` は過去の支払額ではなく現行の価格表から毎回引く**。価格を下げると差額が自動で返る（→ [features.md の #250](./features.md#購入とコイン)）

#### stampBook（#409）

| キー | 内容 |
|---|---|
| `card` | いまのカード `{ id, startDate, size, reward, emoji }` か `null`。`id` は作成時刻 ms、`size` は 5〜60、`reward` は20文字まで |
| `pressed` | 子が押した日（`YYYY-MM-DD` の昇順） |
| `done` | ごほうびを あげた カード。`card` の項目＋`dates`（その時点のスタンプの日付）＋`redeemedOn` |

- もらえる日は保存せず `sessions` から導出する（[3章](#3-派生データ保存しない)）
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

- 連続が途切れて救済できなかったとき、`current` は1に戻るが **`freezes` は没収しない**（[game.js](../js/game.js) `updateStreak`）
- `updateStreak` の戻り値の `frozeDays`（何日ぶん救済したか）は記録直後のポップアップ用の一時値で、**保存しない**

### 削除の墓標 deletedDates（#319）

- 削除した記録の日付を積む。マージで「消したはずの記録が他端末から復活する」のを防ぐ
- 「なおす」で日付を動かしたときの**元の日付も積む**（#358）
- 同じ日に再記録すると外れる（`applySession`/`recomputeState`）
- 剪定しない（1日1エントリ＝1年で約 3.6 KiB）

**設計判断（#319）**

- sessions のマージは両側の日付の union なので、端末Aで消しても、削除を受けていない端末Bの古いコピーから復活する（B起動→resync→union→push で両端末に戻る）
- 記録ID／vector clock を入れる案は不採用。#142 の合意（それらが無い前提で安全側に倒す）を1機能のために覆すと、マージ規則全体の書き直しになる。**同日1件という既存の不変条件を主キーに使う**のが最小
- 剪定が必要になったら「最古の記録より前の墓標を落とす」で足りる
- **`SCHEMA_VERSION` は上げない**：`deletedDates` が無いだけなら `normalizeState` の既定値 `[]` で足りる

## 3. 派生データ（保存しない）

`sessions` / `pet.affinity` などから毎回導出する。**解放済みフラグ類を持たない**のは、二重管理が `recomputeState`（全再計算）との不整合の元になるため。

| 派生値 | 導出元 | 実装 |
|---|---|---|
| 曲の色（#122） | 曲名のハッシュ | [song-color.js](../js/song-color.js) `songColor`。`sessions` が同じならどの端末でも同じ色 |
| 曲別の累計回数（#122） | `sessions` | [record-form.js](../js/record-form.js) `songTotals` |
| 曲マスター👑（#149） | 累計 ≥ `SONG_MASTER_COUNT`(=50) | `isSongMaster` |
| なかよしレベルとご褒美（#124） | `pet.affinity` | [feed.js](../js/feed.js) `affinityLevel` / `affinityRewards` |
| きせかえの購入解放（#126） | `affinityLevel(pet.affinity).level >= unlockLevel` | [shop.js](../js/shop.js) `isUnlocked`。判定は購入時（`canBuy`）だけ。装備・描画は所持だけを見るので、affinity が下がっても所持品は保持される |
| 月間カレンダー（#236） | `sessions` の日別集計 | [history.js](../js/history.js) `monthGrid`/`heatLevel`/`dailyCountMap` |
| スタンプの「もらえる日」と絵柄（#409） | `sessions` の日別合計 ≥ 10・カードの開始日と個数・日付 | [stamp-book.js](../js/stamp-book.js) `eligibleDates`/`cardStatus`/`designForDate`。保存するのは押した日（`pressed`）だけ。記録を直して10回を下回ればスタンプも消える |

## 4. 正規化と型の矯正

`normalizeState(saved)` が担う。全経路（localStorage・Firestore・バックアップ）が通る**唯一の入口ガード**（#272）。

- 不足キーを `DEFAULTS` で補う（`pet`/`streak`/`settings`）
- 未知のトップレベルキーはそのまま引き継ぐ
- フィールド追加程度ならこの補完で済むので、スキーマバージョンは上げない

### 型の矯正（#272）

| 対象 | 矯正 |
|---|---|
| `saved` 自体 | プレーンオブジェクトでなければ `DEFAULTS` |
| `pet` / `streak` / `settings` / `pet.itemLayout` | プレーンオブジェクトでなければ既定（配列も弾く） |
| `sessions` / `inventory` / `badges` / `pet.equippedItems` / `pet.placedItems` | 配列でなければ空配列 |
| `sessions` の各要素 | プレーンオブジェクトでない要素（`null`・文字列・数値）を除く |
| `sessions[].date`（#311） | `YYYY-MM-DD` でなければ**要素ごと落とす**（件数を `console.warn`） |
| `sessions[].totalCount`（#311） | `Number(v) \|\| 0` で数値にして残す |
| `sessions[].songs`（#311） | 配列でなければ空配列。各要素を `{ name: String, count: Number }` にし、`name` が空の曲（文字列 `'abc'` が `['a','b','c']` に化けたものを含む）は除く |
| `pet.stampBook`（#409） | オブジェクトでなければ既定。カード（`card`・`done` の各要素）は `id` が数値でない／`startDate` が日付でなければ**捨てる**。`size` は 5〜60、`reward` は20文字へ丸める。`pressed`・`dates` は日付だけ残す。`emoji` は8文字までの文字列で保存し、表示時に候補8種（`REWARD_EMOJIS`）以外を🎁にする |

- 実在しない日付（`2026-11-00` 等）は書式だけでは弾けないので、判定側（[stamp-book.js](../js/stamp-book.js)）で捨てる

**設計判断**

- **信頼できない入力として扱う（#272）**：入力元は localStorage だけでなく、認証なしの Firestore doc（→ #258）と、親が取り込むバックアップ JSON もある
  - 型の不正が通り抜けると、[app.js](../js/app.js) のモジュールトップの `mergeSameDaySessions(state.sessions)` が throw し、**ES モジュール全体が実行されず画面が真っ白**になる
  - 壊れた値は localStorage に残るのでリロードでも直らない（実質ブリック）
  - 配列かどうかだけでは足りず、`sessions` は要素まで見る（`null` 要素が `s.date` 参照で落ちる）
- **落とすか、直して残すかは値の性質で決める（#311）**
  - `date` は「いつの記録か」で、既定値では捏造できない（連続日数・カレンダーが壊れる）→ 要素ごと落とす
  - `totalCount` / `songs` は 0・空配列という安全な既定値がある → 直して残す
  - 多層防御として `game.js` の `checkBadges` でも `totalCount` を `Number()` で守る（欠けた1件で `challenge_*` バッジが無言で永久に取れなくなるのを防ぐ）
- **スタンプのカードは捏造しない（#409）**：`startDate` を既定で埋めると「どの日から数えるか」を作り出すことになるので捨てる
- **バックアップは矯正ではなく拒否する**：`parseBackup`（[backup.js](../js/backup.js)）は壊れたファイルを `reason: 'shape'` で弾く。`normalizeState` に任せると空配列へ黙って直り、**壊れた記録が消えたことに親が気づけない**

## 5. マイグレーション

破壊的なスキーマ変更（フィールドの削除・改名、ネスト構造の変更、配列要素の形式変更）に備え、state にバージョンを持たせて読み込み時に順に変換する。

| 要素 | 内容 |
|---|---|
| `SCHEMA_VERSION` | 現行バージョン（[storage.js](../js/storage.js)）。state の `version` に保存する |
| `MIGRATIONS[n]` | v(n) を v(n+1) の形へ変える純粋関数 |
| `migrate(saved)` | `version` を現行まで順に上げる。`version` 無しは **v0**。現行より新しい（ダウングレード時）はそのまま返す |
| 読み込み順 | `loadState()` → `migrate()` → `normalizeState()`（構造を整えてから既定値を補う） |

現行の2ステップはどちらも構造変換なし（`version` を付けるだけ）。追加フィールドの既定値は `normalizeState` が補う。

```js
export const SCHEMA_VERSION = 2;
const MIGRATIONS = [
  (s) => s,   // v0（version 無しのレガシー）→ v1: 構造変更なし
  (s) => s,   // v1 → v2: pet.itemLayout を導入（#168）。既定値は normalizeState が補完
];
```

**破壊的な変更を入れる手順**

1. `DEFAULTS` を更新する
2. `SCHEMA_VERSION` を +1 する
3. `MIGRATIONS` の末尾に変換関数を足す（入力を壊さずに返す。`version` の付与は `migrate()` が行う）
4. `tests/storage.test.js` に移行テストを足す
5. 本書の表とバージョンを更新する

例：`streak.freezes` を `maxFreezes` へ改名する場合

```js
export const SCHEMA_VERSION = 3;
const MIGRATIONS = [
  (s) => s,
  (s) => s,
  (s) => ({ ...s, streak: { ...s.streak, maxFreezes: s.streak?.freezes ?? 0 } }),
];
```

> ⚠️ **クラウド側の制約**：Firestore のデータに `version` は無い（`CLOUD_FIELDS` 外）。各端末は自分のローカルコピーだけを移行する。`mergeCloud(local, cloud)` はクラウドのデータに `migrate()` を通さず `normalizeState` の補完だけで取り込むので、**同期対象（`sessions` 等）の構造を破壊的に変えるときは `mergeCloud` の中でも移行を通すこと**。

## 6. クラウド同期

### 6.1 起動シーケンス（ローカルファースト・#142）

1. `loadState()`（localStorage）→ `renderHome()` を**同期で**実行する。最初の描画はクラウドを待たない
2. クラウド同期の起動（`initCloudSync`）は `requestIdleCallback`（非対応なら `setTimeout`）で**アイドルまで遅らせる**。Firebase SDK の動的 import と初期化はここで初めて走る
3. オフライン等で SDK が取れなくてもローカル動作は止めない（`online` 復帰で再試行）
4. `fetchCloud` は「doc が無い（`null`）」と「取れなかった（タイムアウト・通信エラー＝`undefined`）」を分けて返す（#362）

| `fetchCloud` の結果 | 動作 |
|---|---|
| doc あり | 初回取り込み（`reconcileInitialCloud`・union）→ 差分があれば push → 購読開始 |
| `null`（doc 無し） | ローカルにデータがあるとき（`hasLocalData`）だけ、ローカルを丸ごと送る初回移行（`pushCloud`。ack は待たない） |
| `undefined`（取れなかった） | 何も送らない。印（`offlineDirty`）を立て、最初のスナップショットを union で取り込む。30秒ごとに resync を取り直す（`retryResync`・#374） |

- どの場合も、そのあと `initialSyncDone` を立てて `subscribeCloud` で購読を始める（上書き中に返った取得は捨てて購読もしない・[8章](#8-バックアップ復元初期化)）

**設計判断**

- **取れなかったときは送らない（#362）**：旧実装は5秒タイムアウトも `null` で返していたので、遅い回線の起動で doc があるのに「初回移行」としてローカルで `setDoc` 全置換し、他端末の記録を消しえた
  - 最初のスナップショットを cloud-wins にするとローカルだけの記録が消えるので、オフライン復帰と同じく union に倒す
  - doc が本当に無いのに取れなかった場合はスナップショットが来ないので、30秒ごとに resync を取り直し、`null` が返った時点で初回移行する（#374）。予約は1つのタイマーにまとめ、多重に走らせない
  - 再試行はオンラインの間だけ回す。オフラインで止まったら `online` 復帰で再開する（復帰直後の取得が1回失敗しても、そのセッションのうちに送られる）
- **初回移行の `pushCloud` は ack を待たない**：待つと ack までのあいだ `initialSyncDone` が立たず、その間の変更が積まれも印も立たないまま、購読開始後の最初のスナップショット（移行時の内容）を cloud-wins で取り込んで**記録が消える**（レビューで実測）
  - Firestore は書き込みをローカルへ即時反映するので、待たずに購読しても最初のスナップショットにもその後の変更にも載る
  - `pushCloud` は失敗を握りつぶすので、待っても得るものが無い

### 6.2 取り込み経路は3つあり、規則が同じではない

クラウドのデータが state に入る経路は3つ。**平常時の realtime だけ cloud-wins、残り2つは union（ローカル優先）**。

| 経路 | 契機 | 規則 | 失われうるもの |
|---|---|---|---|
| 初回取り込み | 起動後 idle の `fetchCloud`（1回） | `mergeCloudInitial`＝フィールド別にローカル優先（union） | 同日衝突で回数の**少ない方**（keep-larger の既知トレードオフ） |
| 復帰時 resync（#242 #358） | `visibilitychange`→visible、`online` 復帰 | 同上（`reconcileInitialCloud`） | 同上。加えて union の副作用で、**一方で外した装備・置物が戻る**ことがある（記録の削除は墓標で戻らない・#319） |
| realtime | `onSnapshot`（以降ずっと） | `applyRemoteState` → `mergeCloud`＝**cloud-wins**（`CLOUD_FIELDS` をまるごと差し替え）。自分の書き込みのエコーは差分比較でスキップ。`deletedDates` だけは union し、墓標の日付の記録は取り込まない（#319）。**印（`offlineDirty`）が立っている間は union で取り込む**（#358） | **まだ送っていないローカルの変更**（debounce の待ち・既定2秒）。ただし保留は thunk で持つので、待ち時間中に届いた他端末の確定済み記録は次の送信で巻き戻らない（#313） |

**設計判断**

- **realtime を cloud-wins のままにする**：平常時に union を使うと、一方で外した装備が相手のスナップショットのたびに戻り続け、操作が確定しない
  - 失うのは debounce 待ちの数秒ぶんだけ。記録の確定は `flushCloud()` で即送るので**記録そのものは落ちない**
  - フィールド別のタイムスタンプ／世代管理で根本から解くのは #258（認証＋ルール）と合わせて別途
- **初回と復帰時だけ union にする**：初回に cloud-wins を使うと、idle 同期の前にローカルで記録した内容を上書きしてしまう
- **復帰時は fetch して union する（#242）**
  - `pushCloud` は `setDoc`（merge 無し＝doc 丸ごと置換）。realtime の `mergeCloud` は `pet` をまるごと差し替える
  - iOS PWA 等はサスペンド中に `onSnapshot` が届かない。復帰直後の古い state のまま操作すると、古い `pet` が `placedItems`/`itemLayout` ごとクラウドを上書きし、**他端末で置いた置物が消える**
  - そこで `visibilitychange`→visible で `fetchCloud` → 非破壊の union（`reconcileInitialCloud`）を通してから操作を受ける。差分が無ければ getDoc 1回で終わる
- **オフライン復帰は push ではなく resync（#358）**
  - 旧実装は `online` で `pushCloud(state)` を無条件に撃っていた。オフライン中は `onSnapshot` が届かず state が古いので、**その間に他端末が確定した記録を消す**
  - 逆に、オフライン中の自分の記録は `pushCloud` が早期 return で送らない（#288）ため、再接続で届いたスナップショットの cloud-wins で消えていた
  - 取り込めなかった（`null`／`undefined`）ときは印を下ろさない
- **印（`offlineDirty`）の上げ下げ（#358 #362 #374）**

  | | 契機 |
  |---|---|
  | 立てる | オフライン中の `commitState`・スタンプ・目標変更（いずれも `queueCloudPush` 経由）／`offline` イベント（debounce 待ちのままオフラインをまたいだ変更のため）／初回 `fetchCloud` が取れなかったとき |
  | 下ろす | 復帰時 resync（`online`/`visibilitychange`）が取り込めて、かつその時点でオンラインのとき（`resyncAndSettle`）／オンラインで届いたスナップショットを union で取り込んだとき |
  | 下ろさない | fetch を待つ間に再びオフラインになったとき |

  オンライン中の debounce 待ちの数秒ぶんは従来どおり cloud-wins のまま（外した装備が戻り続けない性質は変えない）
- **不採用：SDK にオフライン書き込みを積ませる**（`pushCloud` の早期 return をやめる）。再接続時に setDoc 全置換がそのまま送られ、他端末の記録を消す向きが逆になるだけ
- **既知の制限**：起動後にいったん取り込めた端末が、`navigator.onLine === true` のまま不通の回線（キャプティブ Wi-Fi 等）へ移ると印が立たず、SDK がメモリに積んだ `setDoc` 全置換を再接続時に送る。起動時から不通の場合は #362 / #374 で塞いだ

### 6.3 初回取り込みのマージ（mergeCloudInitial＝ローカル優先）

`mergeCloudInitial(local, cloud)` がフィールドごとに突き合わせ、`recomputeState` で導出値を出し直してから反映する。結果がクラウドと違えば（ローカルだけの記録があった等）`pushCloud` で確定する。

| フィールド | 規則 | 理由 |
|---|---|---|
| `sessions` | `mergeSessionsKeepLarger(l, c, deletedDates)`：日付で1日1件に解決。両側にあれば `totalCount` の**大きい方**（**合算しない**）。並びは日付の降順、同回数ならローカル。付与値 `bonusCoins`/`praise`/`tempo` は「どちらかに付いていれば残す」（#148 #315）。`deletedDates` の日付は除く（#319） | 合算すると部分同期後の共有ぶんを二重に数え、コイン/XP が恒久的に水増しされる |
| `deletedDates` | 両側の **union**（#319） | 片方で消したものは消えたまま |
| `inventory` | 重複を除いた **union** | 所有は増える一方 |
| `pet.equippedItems` / `pet.placedItems` | union のうち、マージ後の `inventory` にあるものだけ（#226） | 持っていない装備・配置を残さない |
| `pet.itemLayout` | **union**（クラウドを土台にローカルで上書き・#242） | placedItems だけ union して座標をローカル固定にすると、他端末で置いた置物が既定位置へ戻る |
| `pet.affinity` / `pet.foodSpent` | **max** | sessions から導出できない累積値 |
| `pet.lessonDates` / `pet.lessonRemoved` | 登録は「登録の union − 墓標の union」、墓標は union（`mergeLessonDates`・#393） | 墓標が無いと、解除したときに前面にいなかった端末の古い登録が毎回戻る |
| `pet.stampBook`（#409） | `done` は `id` で union、`pressed` は union。`card` は相手側で `done` に入っていれば捨て、両側にあれば `id`（作成時刻）の新しい方、同じ `id` ならローカル | 押した・あげた は取り消さない操作なので失わない。終わったカードを `card` に戻すと同じごほうびを二度もらう |
| 上記以外の `pet` フィールド（`name`/`dailyGoal`/`catStyle`/`childName`/`childAvatar`）・`settings` | **ローカル** | — |
| `pet.coins`/`xp`/`level`・`streak`・`badges` | マージ後の `sessions` から `recomputeState` で出し直す（`spent = spentCoins(マージ後 inventory) + pet.foodSpent`） | sessions が唯一の正 |

**設計判断（topic_1780534255497 で合意）**：同日衝突は合算ではなく **keep-larger**。無損失（合算）より**経済の水増しを避ける**ことを優先した。水増しは取り消せず気づきにくく、コイン/レベル/連続の整合を壊す。朝スマホ・夜タブレットで同じ日に別端末で記録した稀なケースでは小さい方を失う。合算するには記録ID か vector clock が要る（#142 のスコープ外）。

### 6.4 書き込み（遅延バッチ・#146）

`commitState` はローカルへ即保存し、クラウドへは `pushCloudDebounced`（既定 2000ms）で送る。待ちの間は最新だけを持ち、スタンプ連打・購入・えさやりの連続操作を**1回の書き込みにまとめる**。

| 契機 | 動作 |
|---|---|
| 記録の確定（`submitRecord`） | `commitState` の直後に `flushCloud()` で即送る |
| タブ非アクティブ（`visibilitychange`→hidden）／離脱（`pagehide`） | `flushCloud()` で保留分を確定する |
| オフライン中 | `flushCloud()` は保留を消さずに持つ（#288） |
| 初回の取り込みが済むまで（`initialSyncDone` 前）／印が立っている間 | `queueCloudPush` は**何も積まない**（#374）。ローカルには保存済みで、次の union 取り込みが差分を押し戻す |
| 明示的な上書き（復元・初期化・がぞくコード移行） | `queueCloudPush` を通らず即 push（[8章](#8-バックアップ復元初期化)） |

- キューの実体は firebase に依存しない [cloud-queue.js](../js/cloud-queue.js)（`createCloudQueue(pushCloud)`）。`cloud.js` は firebase CDN を静的 import するので単体テストできないが、キューは `tests/cloud-queue.test.js` で直接検証する

**設計判断**

- **ローカルは即時・クラウドだけ遅らせる**：debounce を延ばすほど書き込みは減るが反映が遅れる。ライフサイクル境界の `flushCloud()` を必須にして「まとめつつ取りこぼさない」を両立した
- **保留は値ではなく thunk で持つ（#313）**：保留を `() => cloudFields(state)` で持ち、送る時点の state を読む
  - 値で焼き付けると、保留中に `applyRemoteState` 等で state が替わっても古い内容を `setDoc` 全置換で送り、**他端末の確定済み記録を巻き戻す**
  - 「保留中に state が変わったら捨てる」方式は、state を変える経路が増えるたびに無効化を足し忘れるので採らない
  - 送る時点で最新を読めば、`visibilitychange`/`pagehide` の flush が古い state を送る問題も同時に消える
  - 印より前に積まれた保留（オンラインで積んだ debounce が、オフラインをまたいで復帰後の resync より先に flush される）も、thunk が印を見て `null` を返し `cloud-queue.js` が送らない
- **`initialSyncDone` で `online` をガードする（#313）**：`fetchCloud`（最大5秒）を待つ間に `online` が来ても、マージ前のローカルを送らない。`cloudSynced`（import 成功で立つ）とは別のフラグにした
- **取り込む前は送らない（#374）**：旧実装は取得待ち（最大5秒）・取得失敗の間の操作も、debounce 後や記録確定時に `setDoc` 全置換で送っていた。遅い回線やキャプティブ Wi-Fi では、SDK が積んだ書き込みが再接続時に他端末の記録を消しえた。自分の書き込みのエコーが最初のスナップショットとして返ると、自分自身との union で印まで下りていた
  - 不採用：保留しておいて送るときに判断する（`cloud-queue.js` 側で保留）。判断がキューと app.js に分かれ、#313 と同じく経路が増えるたびに漏れる。**送るのは union 取り込みの1箇所だけ**に揃える方が単純
  - 既知の制限：取得待ち・取得失敗の間に装備や置物を外しても、クラウドに残っていれば union で戻る

## 7. がぞくコード（doc ID の推測不能化・#233 段階1）

旧仕様の doc ID は固定（既定 `pianopet/data`／テスト用 `pianopet/test`）。Firebase config はクライアントに埋め込まれた公開情報なので、**認証なしでは第三者が到達できる**。段階1として、doc ID を初回に作るランダム値（**がぞくコード** `pp-<uuid>`）へ置き換える。

| 項目 | 内容 |
|---|---|
| 保存 | 端末ローカル `piano-pet:cloud-ids`。**クラウドには載せない** |
| 移行前 | `cloudDocIdFor` は旧固定IDを返す＝移行するまで挙動は変わらない |
| 移行（親ゲート内の明示操作） | ①ローカルへ自動退避（`piano-pet-backup-before-migrate`）②コードを作る ③新 doc へ今のデータをコピー ④コードを保存 ⑤リロード |
| 他の端末 | **コードを入力**するか、コード入りのバックアップJSON（#140）を取り込んで同じ doc に合流する。合流後の初回同期は union なのでローカルは消えない |
| 旧 doc | 自動では消さない。全端末が合流したあと親が「ふるい ばしょを からにする」で空にする |
| アカウント | コードはアカウント単位（#182 の分離は保たれる） |

**設計判断**

- **自動移行にしない**：端末ごとに別のコードができると家族の共有 doc が割れる。移行は親の操作にし、他端末はコードで合流させる
- **旧 doc に転送先を書き置かない**：旧IDを知る第三者がそこから新IDへ届いてしまい、「推測しても到達できない」を満たさない。コードは**帯域外（画面表示／バックアップJSON）**で共有する
- **本命の匿名認証＋セキュリティルールは段階2（#258）**：匿名認証は端末ごとに UID が違うので、「自分の UID 配下だけ許可」のルールだと複数端末の共有が壊れる。クレデンシャルの引き継ぎか実アカウント認証（Google 等）の設計が別に要る
- セキュリティルールは間借り元 `dtask-d08b6` の Firebase コンソールで管理している（リポジトリ外・dtask にも影響）

## 8. バックアップ／復元・初期化

認証なし・匿名同期なので、端末の故障やブラウザのデータ削除で記録が消えうる。親が JSON で手元に保存し、いつでも戻せるようにする安全弁（[backup.js](../js/backup.js)・#140 #183）。UI と文言は [features.md](./features.md#せってい親ゲートの内側)。

### ファイル形式

- ファイル名は `piano-pet-backup-YYYY-MM-DD.json`
- `exportState(state)` が文字列にする。Blob 化とダウンロードは [app.js](../js/app.js)
- がぞくコード（#233）があれば `cloudDocId` を同梱し、別端末で復元したときに同じ保存先へつなぐ

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

`{ok:true, state, cloudDocId}` か `{ok:false, reason}` を返す（`cloudDocId` は形式が正しいときだけ非 null）。通ったら `migrate()` → `normalizeState()` で現行スキーマに整える。

| reason | 条件 |
|---|---|
| `parse` | JSON として壊れている |
| `marker` | `app !== 'piano-pet'`（別アプリ・マーカー無し） |
| `shape` | `state.pet` / `state.streak` が無い・配列（最小のスキーマ検証）／`sessions`・`inventory`・`badges` が配列でない（#272） |
| `future` | `schemaVersion` が現行より大きい（ダウングレードでの破損を防ぐ） |

### 上書きの手順（復元・初期化で共通）

`applyImportedState`（[app.js](../js/app.js)）は明示的な上書き。購読中に取り込むと、push が届く前に**古いスナップショットが `onSnapshot` で降ってきて結果を巻き戻す**ので、次の順で行う（topic_1780530736889 で合意）。

1. 今の localStorage を `piano-pet-backup-before-restore` へ自動退避する
2. 購読解除（`cloudUnsub`）で **onSnapshot を止める**。復帰時 resync と30秒の再試行も止める（`stopCloudForOverwrite`・#378）
3. `saveState(imported)` でローカルに反映する
4. `await pushCloud(cloudFields(imported))` で**クラウドへの反映を待つ**（**上限10秒**・`pushForOverwrite`・#381）。がぞくコード入りのファイルは `pushCloudDoc(コード, …)` でそのコードの doc へ書く（#358）
5. `window.location.reload()` で起動し直す。10秒以内に ack が返っていれば、リロード後の `fetchCloud()` は送った内容を返すので巻き戻らない（見切った場合は下の設計判断「ack は10秒で見切る」）

- **初期化（`resetData`・#183）**は取り込み対象が `normalizeState({})`（新品の `DEFAULTS`）になるだけで同じ手順。`settings` 等の端末ローカル値も既定へ戻る
- オフラインのときは push せずに reload する（`pushCloudDoc` には早期 return が無く、オフラインの `setDoc` は解決しないので app 側で守る）。このときクラウドは置き換わらず、次の初回同期は union になる＝**復元が「置き換え」でなく「マージ」に弱まる**

**設計判断**

- **購読解除＋完了待ち＋reload の三段**：購読を解かず差分比較だけに頼ると、import 直後の古いスナップショットが `mergeCloud` で取り込み結果を上書きしうる。三段で競合を物理的に断つ
- **がぞくコード入りの復元は `pushCloudDoc`（#358）**：`cloud.js` の `DATA_DOC` は import 時点（切替前）の doc に固定される。`pushCloud` だと、親が空にした旧・推測可能な doc へ家族のデータを書き戻してしまう
- **上書き中は他の経路を止める（#378）**：ack を待つ間に、先に走っていた resync（`visibilitychange`/`online`/`retryResync`）の取得が返ると、上書き前の古いクラウドと union した state を `reconcileInitialCloud` が送り、復元より後に届いて古い記録が混ざる（初期化なら消したはずの記録が戻る）。`overwriting` で止めるのは次の4経路
  1. `reconcileInitialCloud`
  2. resync の取り込みと初回移行
  3. **起動直後の初回取得**（上書き中に返ったら捨て、購読も張らない。張ると旧 doc のスナップショットが cloud-wins で復元を消す）
  4. **debounce の保留**（thunk が `null` を返す。がぞくコード付きの復元では送り先が切替前の旧 doc のため）

  リロードで全体が張り直されるので、`overwriting` を下ろす必要は無い
- **ack は10秒で見切る（#381）**：`navigator.onLine` が true なのに不通の回線（キャプティブ Wi-Fi 等）では `setDoc` がタイムアウトせず、reload へ進まない。親には「よみこむ」「ぜんぶ けす」を押しても何も起きないように見えていた。復元と初期化の push を `pushForOverwrite` にまとめ、初期化にも無かったオフラインのガードを揃えた
  - 見切ったときの帰結：未送信の書き込みはリロードで捨てられ（`getFirestore` 既定の memory cache）、次の初回同期は union。**復元は「マージ」に弱まり、初期化は旧クラウドのデータがほぼ戻る＝実質取り消し**（ローカルは退避済み）。送信済みで ack だけ遅れた書き込みは、新しいページの購読か初回 fetch が受け取るので、最終状態は「置き換え」か「union」のどちらかで、それより悪くはならない
  - 値の根拠：通常の回線でも、長いアイドル後の write stream の張り直し等で ack に数秒かかる。短いほど上書きが弱まるので、`fetchCloud` の5秒より長い10秒にした（頻度の低い操作なので待ち時間より確実さを優先）
  - 見切ったことを親に伝える導線と、次回起動での再送は #384
- **初期化は UI で行う（#183）**：Firestore を直接消す案もあったが、親が端末だけで完結できる UI を採った。復元と手順を共有して実装を最小にし（競合対策・退避を再利用）、専用画面を増やさず親ゲート内に置いた

## 9. マルチアカウント（アカウント分離・#182）

検証用と実運用でデータを分ける。認証は入れず、**読み書きする Firestore doc と localStorage キーをアカウント単位で名前空間化する**だけ。純粋ロジックは [account.js](../js/account.js)、UI は親ゲート内の「アカウント」。

| 項目 | 内容 |
|---|---|
| 既定アカウント | 娘（`id: 'data'`）／テスト用（`id: 'test'`）。一覧と有効アカウントは `piano-pet:accounts` |
| 名前空間 | localStorage は `storageKeyFor(id)`、Firestore doc は `cloudDocIdFor(id)`。`data` は既存の保存先（localStorage `piano-pet`・doc `pianopet/data`）をそのまま指すので、**娘の既存データは移動しない** |
| 切替 | 親ゲートの奥で `setActiveAccount(id)` → `window.location.reload()`。`cloud.js` は doc を import 時の有効アカウントで固定するが、切替が必ずリロードを伴うので整合する |

**設計判断（#182）**

- Firebase の匿名／Google 認証で `users/{uid}` の下に置く案もあった。piano-pet は「認証なし・ルールでアクセス制御」で dtask のプロジェクト（`dtask-d08b6`）を間借りしており、認証の導入は共有プロジェクトとデータ構造への影響が大きい。**家庭内ツール前提**で doc の切替に倒した
- 誰でも全アカウントを見られるが、子の切替は親ゲートで防ぐ
- **前提（Firestore ルール）**：テスト用は `pianopet/test` を読み書きするので、ルールが `pianopet` コレクション全体（doc ワイルドカード）を許可している必要がある。`pianopet/data` 限定だとテスト用への書き込みが拒否され、ローカルのみで動く（`pushCloud` は失敗を握りつぶす）

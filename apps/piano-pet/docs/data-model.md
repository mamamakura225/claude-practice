# データモデル（設計書）

> **スキーマ・マージ規則・永続化の正本**。要件は [requirements.md](./requirements.md)、画面と機能のふるまいは [features.md](./features.md)。
> **更新ルール**: `apps/piano-pet/` のソースを変更したら関連docsへ必ず反映（[CLAUDE.md](../../../CLAUDE.md)）。

state は localStorage に JSON で保存する。保存キーは**有効アカウント**（#182）から導出し、既定（娘）は `piano-pet`、テスト用は `piano-pet:test`。読み込み・正規化・クラウド射影は [js/storage.js](../js/storage.js) に集約（キー導出は [js/account.js](../js/account.js) `storageKeyFor`）。

## State スキーマ (v2)

| フィールド | 型 | クラウド同期 | 説明 |
|---|---|:---:|---|
| `version` | number | − | スキーマバージョン。現行 `2`（v1→v2 は `pet.itemLayout` の導入・#168）。端末ローカルのみ |
| `pet` | Pet | ✓ | ペット本体 |
| `inventory` | string[] | ✓ | 購入済みショップアイテムID |
| `streak` | Streak | ✓ | 連続練習記録 |
| `badges` | string[] | ✓ | 獲得バッジID |
| `sessions` | Session[] | ✓ | 練習セッション履歴（XP/レベル等の計算元） |
| `settings` | Settings | − | 端末ローカル設定（音など）。クラウド非同期 |

クラウド（Firestore `pianopet/<doc ID>`）に載るのは `CLOUD_FIELDS`（`pet, inventory, streak, badges, sessions`）のみ。doc ID は [account.js](../js/account.js) `cloudDocIdFor`（[cloud.js](../js/cloud.js) が import 時に束縛）で導出する。`settings` と `version` は端末ローカルに留まる。

旧 `assignment`（しゅくだい・#143）は機能削除（#261）で同期対象から外した。既存データに残る値は `normalizeState` の未知キー引き継ぎで無害に残り、クラウド doc からは次回 push（setDoc 置換）で消える。旧 `Assignment` スキーマ・LWW マージ（`pickNewerAssignment`）・関連 UI はコードから撤去済み。

### doc ID の推測不能化（がぞくコード・#233 段階1）

旧仕様は doc ID が固定・推測可能（既定=`pianopet/data`／テスト用=`pianopet/test`）。Firebase config はクライアント埋め込みの公開情報のため、**認証なしでは第三者が到達できる構造的リスク**があった。段階1として doc ID を初回生成のランダム値（**がぞくコード** `pp-<uuid>`）へ置き換える。

| 項目 | 内容 |
|---|---|
| 保存 | 端末ローカル `piano-pet:cloud-ids`（`{ [アカウントID]: コード }`）。**クラウドには載せない** |
| 未移行時 | `cloudDocIdFor` は旧固定IDへフォールバック＝**移行するまで挙動は変わらない**（後方互換） |
| 移行 | 親ゲート内の明示操作。①ローカルへ自動退避（`piano-pet-backup-before-migrate`）②コード生成 ③新 doc へ現行データをコピー ④コード保存 ⑤リロード |
| 複数端末 | 他端末は**コード入力**、またはコードを同梱したバックアップJSON（#140）の取り込みで同じ doc に合流。合流後の初回同期は union マージ（`mergeCloudInitial`）なのでローカルデータは消えない |
| 旧 doc | 移行しても自動では消さない。全端末の合流後に親が明示操作で空にする（`ふるい ばしょを からにする`） |
| アカウント分離 | コードはアカウント単位なので #182 の分離は維持 |

> **設計判断（#233 段階1）**
> - **自動移行にしない**：端末ごとに別コードが生成されると家族の共有 doc が割れて同期が壊れる。移行は親の明示操作にし、他端末はコード共有で合流させる
> - 旧 doc に「新しい doc への転送先」を書き置く案は不採用。旧 ID を知る第三者がそこから新 ID へ到達でき、受け入れ基準（推測しても到達できない）を満たさない＝コードは**帯域外（コード表示／バックアップJSON）で共有**する
> - **本命の匿名認証＋セキュリティルールは段階2**（#258）：匿名認証は端末ごとに UID が異なるため「自分の UID 配下のみ許可」ルールだと複数端末共有が壊れる。クレデンシャル引き継ぎか実アカウント認証（Google等）の設計が別途必要
> - セキュリティルール自体は間借り元 `dtask-d08b6` の Firebase コンソール管理（リポジトリ外・dtask にも影響）

### State 以外の localStorage キー（端末ローカル・クラウド非同期）

| キー | 値 | 用途 |
|---|---|---|
| `piano-pet-onboarded` | `'1'` | 初回オンボーディング（紙芝居・#141）を見たか。端末ごとに案内するため state に含めない（[onboarding.js](../js/onboarding.js)）。アカウント横断で共有 |
| `piano-pet:accounts` | `{ active, accounts: [{id,name}] }` | マルチアカウント（#182）の有効アカウントと一覧（[account.js](../js/account.js)）。壊れていれば既定2アカウント（娘=`data`／テスト用=`test`）にフォールバック |
| `piano-pet:cloud-ids` | `{ [アカウントID]: コード }` | がぞくコード（#233・上記） |
| `piano-pet-backup-before-restore` | State JSON | 復元・初期化の直前に現行 state を退避（`RESTORE_BACKUP_KEY`・#140/#183） |
| `pp-theme` | `'light'` \| `'dark'` | 画面のあかるさ（#151）。`auto` は保存せず属性を付けない |
| `<アカウントキー>:stamp-draft` | `{ date, stamps: string[] }` | 当日のスタンプ下書き。ホーム戻り→記録再開でカードを引き継ぐ（#164）。打鍵ごとに保存。**初回記録前のみの引き継ぎ用**で、記録確定後は当日セッションが正となり記録画面はセッションから復元する（#186）。読み出し時に `date !== todayStr()` なら破棄。**記録画面のひづけ欄が今日以外を指している間は書き込まない**（過去日の入力で当日の下書きを潰さない・#273）。**アカウントごとに分離** |

### Session

1件＝「ある日付の練習記録」。XP・レベル・コイン・ストリーク・バッジの**唯一の計算元**で、編集・削除時は `recomputeState` がこの配列だけから全状態を再構築する。生成は [game.js](../js/game.js) `applySession`、曲の集約は [record-form.js](../js/record-form.js) `collectSongs`。

> ⚠️ ここが崩れると全部が崩れる。sessions を直接書き換える処理を足すときは必ず `recomputeState` を通すこと。

| フィールド | 型 | 説明 |
|---|---|---|
| `date` | `YYYY-MM-DD` | 練習したローカル暦日。同一日付は記録時に1件へ統合（`mergeSameDaySessions`） |
| `songs` | `Song[]` | 曲ごとの回数リスト（空名・0回以下は除外済み）。`Song = { name: string, count: number }` |
| `totalCount` | number | その日の合計回数（`songs` の `count` 合計） |
| `coinsEarned` | number | その記録で得た**基本**コイン（`calcRewards`。再計算で都度上書き。表示・参照用。おまけは含まない） |
| `xpEarned` | number | その記録で得たXP（同上） |
| `bonusCoins` | number | きょうのおまけ（#148）で得た乱数由来のコイン。**記録に保存して `recomputeState` で復元**（再抽選しない）。0=未当選 |
| `praise` | string \| null | はなまるスタンプ（#145）。`PRAISE_STAMPS` の id（`hanamaru`/`jouzu`/`ganbatta`）か `null`。曲数からは導出されないが、全状態のスプレッド更新（`recomputeState`・各種マージ）で保持される。表示時に `normalizePraise` で検証 |
| `tempo` | string \| null | 練習の質メモ（#239）。`TEMPO_STAMPS` の id（`slow`🐢/`normal`🎵/`fast`🚀）か `null`。praise と同型・同挙動（`normalizeTempo` で検証）。自由記述は持たない（PII規約準拠） |

> **設計判断（#148・おまけコインの永続）**: コインは `recomputeState` で全再計算される派生値なので、乱数ボーナスをそのまま足すと再計算で消える。別アキュムレータではなく**記録への保存値 `bonusCoins`** で解決した。抽選は app.js（`rollDailyBonus(Math.random())`）がその日の初回記録時だけ行い、`applySession(state, session, bonusCoins)` で記録へ焼き込む。`recomputeState` が `s.bonusCoins` を `earned` へ再加算するため、編集・削除・クラウドマージ後も再抽選されず金額が保たれる。`game.js` は純粋なまま（乱数は注入）。

### 派生データ（保存しない）

保存フィールドを持たず `sessions` / `pet.affinity` から都度導出する。**解放済みフラグ類を持たない**のは、二重管理が `recomputeState`（全再計算）との整合リスクになるため。

| 派生値 | 導出元 | 実装 |
|---|---|---|
| 曲の色（#122） | 曲名の決定的ハッシュ | [song-color.js](../js/song-color.js) `songColor`。保存しないので `sessions` さえ同じならどの端末でも同じ色 |
| 曲別の累計回数（#122） | `sessions` の再集計 | [record-form.js](../js/record-form.js) `songTotals` |
| 曲マスター👑（#149） | 累計 ≥ `SONG_MASTER_COUNT`(=50) | `isSongMaster` |
| なかよしレベルとご褒美解放（#124） | `pet.affinity` のしきい値 | [feed.js](../js/feed.js) `affinityLevel` / `affinityRewards`。`recomputeState` は affinity を保持するため全再計算でも矛盾しない |
| きせかえ購入の解放ゲート（#126） | `affinityLevel(pet.affinity).level >= unlockLevel` | [shop.js](../js/shop.js) `SHOP_ITEMS` の静的カタログ値 `unlockLevel` と比較（`isUnlocked`）。判定は購入時（`canBuy`）のみで、装備・描画は inventory/equippedItems の所属だけを見る＝affinity 低下で再ロックされても所持品は保持される |
| 月間ヒートマップ（#236） | `sessions` の日別集計 | [history.js](../js/history.js) `monthGrid`/`heatLevel`/`dailyCountMap` |

### Pet

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | string | `'きーちゃん'` | 猫の名前 |
| `level` | number | `1` | XPから算出される現在レベル |
| `xp` | number | `0` | 累計経験値 |
| `coins` | number | `0` | 所持コイン（= 獲得総額 − 装備購入 − えさ消費）。`recomputeState` では `Math.max(0, 獲得総額 − spent)` で再導出する。`spent` ＝ `spentCoins`（インベントリ価格合計）＋ `foodSpent` で [app.js](../js/app.js) が算出して渡す（購入・えさ消費分が再計算で復活しない）。**`spentCoins` は過去の支払額ではなく現行価格から毎回導出する**ため、価格改定を行うと差額が自動返金される（→ [features.md](./features.md) の #250 設計判断） |
| `equippedItems` | string[] | `[]` | 装備中アイテムID（スロットごとに1つ） |
| `placedItems` | string[] | `[]` | 配置中の置物・小物系アイテムID（シーン配置型・#226）。装備（slot排他）とは**別配列で排他なし複数配置**（`togglePlace`/`placeItem`/`unplaceItem` が管理し装備ロジックには触れない） |
| `itemLayout` | object | `{}` | 衣装**と置物**の自由配置 `{ itemId: {x_pct, y_pct, scale?, layer?} }`（#168/#205/#226/#270・.cat正方枠%）。`scale` は絶対値、`layer` は `'front'|'back'`（猫の前後・#270）。**未登録キーは既定にフォールバック**（位置＝アンカー／サイズ＝基準スケール／レイヤー＝装着は前面・置物は `SCENE_BOX[id].layer`）。装備・配置外しは `cleanItemLayout` が掃除（置物IDは装着IDと重複しないため両系統で共用）。操作仕様は [features.md](./features.md) |
| `affinity` | number | `0` | なかよし度（えさやりで上昇）。3段階tier（low/mid/high）に集約され猫画像の表情・ポーズに反映（#167） |
| `foodSpent` | number | `0` | えさに使ったコイン総額（全再計算で消費分を復活させないため） |
| `dailyGoal` | number | `10` | 1日の練習目標回数（#238）。親が **5〜20** で調整（`clampDailyGoal`）。ホームの進捗メーター・スタンプのマス数/分母/音程にのみ反映。**達成ボーナス閾値（`GOAL_BONUS_THRESHOLD=10`）とは分離**＝可変にしても `recomputeState` が過去の記録のコインを動かさない。未設定の旧データは `normalizeState` が 10 で補完 |
| `catStyle` | string | `'tora'` | 猫スタイル（#66）。`'tora'` / `'shiro'` / `'russianblue'`。未知値は表示側（`normalizeStyle`）が tora にフォールバック |
| `childName` | string | `''` | こども本人の名前（#121）。前後空白を落とし12文字に丸める（`normalizeChildName`）。**PII規約**：analytics には送らない。空なら名前ラベルは非表示 |
| `childAvatar` | string | `'chick'` | こどものアイコン絵文字ID（#121・[child-profile.js](../js/child-profile.js) `CHILD_AVATARS`）。**顔写真は使わない**（認証なしの共有 Firestore に置くため）。未知・未設定は `normalizeChildAvatar` が 🐥 にフォールバック |

`pet` 配下は CLOUD_FIELDS にまとめて乗るため、フィールド追加時にマージ規則の追加は不要（realtime は pet ごと cloud-wins、初回マージは下表の規則）。

### Streak / Settings

| Streak | 型 | デフォルト |
|---|---|---|
| `current` / `best` | number | `0` |
| `lastPracticeDate` | `YYYY-MM-DD` \| null | `null` |
| `freezes` | number | `0` |

| Settings | 型 | デフォルト |
|---|---|---|
| `soundOn` | boolean | `true` |

> **注**: ストリークが途切れて救済もできなかった場合、`current` は 1 にリセットされるが **`freezes`（お休み券）は没収されず維持される**（[game.js](../js/game.js) `updateStreak`）。
> **注**: `updateStreak` の戻り値の `frozeDays`（何日ぶん救済したか）は記録直後のポップアップ表示用の一時プロパティで**永続化されない**。`streak` スキーマのフィールドと誤認しないこと。

正規化は `normalizeState(saved)` が担い、`pet`/`streak`/`settings` の不足キーを `DEFAULTS` で補完する（未知のトップレベルキーは spread でそのまま引き継がれる）。フィールド追加程度であれば正規化のデフォルト補完だけで済むため、スキーマバージョンを上げる必要はない。

### 型の矯正（信頼できない入力に対する唯一の入口ガード・#272）

`normalizeState` は不足キーの補完だけでなく**型の矯正**まで行う。

| 対象 | 矯正 |
|---|---|
| `sessions` / `inventory` / `badges` / `pet.equippedItems` / `pet.placedItems` | 配列でなければ空配列へ |
| `sessions` の各要素 | プレーンオブジェクトでない要素（`null`・文字列・数値）を除去 |
| `pet` / `streak` / `settings` / `pet.itemLayout` | プレーンオブジェクトでなければ既定へ（配列も弾く） |
| `saved` 自体 | プレーンオブジェクトでなければ `DEFAULTS` |

> **設計判断（#272）**: state の入力元は localStorage だけでなく、**認証なしの Firestore doc（→ #258）と親が取り込むバックアップ JSON** も含まれる＝内容を信頼できない。`normalizeState` は全経路が通る唯一の関門で、型不正が通り抜けると [app.js](../js/app.js) のモジュールトップの `mergeSameDaySessions(state.sessions)` が throw し、**ES モジュール全体が実行されず画面が真っ白**になる。壊れた値は localStorage に残るためリロードでも復旧しない（実質ブリック）。配列であることの確認では足りず `sessions` は要素まで見る（`null` 要素が `s.date` 参照で落ちる）。
>
> **バックアップ側は矯正ではなく拒否**：`parseBackup`（[backup.js](../js/backup.js)）は壊れたファイルを `reason: 'shape'` で弾く。`normalizeState` に任せると空配列へ黙って矯正され**壊れた記録が消えたことに親が気づけない**ため、取り込み前にエラーを出す。

## マイグレーション戦略

破壊的なスキーマ変更（フィールドの削除・改名、ネスト構造の変更、配列要素の形式変更）に備え、state にバージョン番号を埋め込んで読み込み時に順次適用する。

- `SCHEMA_VERSION`（[storage.js](../js/storage.js)）が現行バージョンで、state の `version` に保存される
- `MIGRATIONS[n]` は **v(n) を v(n+1) の形に変換する純粋関数**
- `migrate(saved)` が `version` を現行まで順に引き上げる。`version` 無しの旧データは **v0** 扱い、現行より新しいデータ（ダウングレード時）は**バージョンを下げず**そのまま返す
- 読み込みフローは `loadState()` → `migrate()` → `normalizeState()`（構造を整えてからデフォルト補完）

**変更手順**：①`DEFAULTS` を更新 →②`SCHEMA_VERSION` を +1 →③`MIGRATIONS` 末尾に変換関数を追加（入力を破壊せず返す。`version` の付与は `migrate()` が行う）→④`tests/storage.test.js` に移行テストを追加 →⑤本書の表とバージョンを更新。

現行の2ステップはどちらも**構造変換を伴わない**（`version` の付与だけ）。追加フィールドの既定値は `normalizeState` が補完するため変換関数が要らない。

```js
export const SCHEMA_VERSION = 2;
const MIGRATIONS = [
  (s) => s,   // v0（version 無しのレガシー）→ v1: 構造変更なし
  (s) => s,   // v1 → v2: pet.itemLayout を導入（#168）。既定値は normalizeState が補完
];
```

次に**破壊的**な変更を入れるときは、末尾に変換関数を足す（例: `streak.freezes` を `maxFreezes` へ改名する場合）:

```js
export const SCHEMA_VERSION = 3;
const MIGRATIONS = [
  (s) => s,
  (s) => s,
  (s) => ({ ...s, streak: { ...s.streak, maxFreezes: s.streak?.freezes ?? 0 } }),
];
```

**クラウド側の制約**：Firestore のデータに `version` は含めない（`CLOUD_FIELDS` 外）。各端末は読み込み時に自分のローカルコピーを移行する。`mergeCloud(local, cloud)` はクラウドデータに `migrate()` を適用せず `normalizeState` の補完だけで取り込むため、**同期対象フィールド（`sessions` 等）の構造を破壊的に変えるときは `mergeCloud` 内でも取り込み前に移行処理を通すこと**。

## 起動シーケンスとクラウド同期（ローカルファースト・#142）

1. `loadState()`（localStorage）→ `renderHome()` を**同期実行**（最初の描画はクラウドを待たない）。
2. クラウド同期の起動（`initCloudSync`）は **`requestIdleCallback`**（非対応環境は `setTimeout`）で**アイドル時間まで遅延**。Firebase SDK の動的 import（CDN 取得）と初期化はこの時点で初めて走り、初回描画・操作と競合しない。
3. オフライン等で SDK 取得に失敗してもローカル動作は妨げない（`online` 復帰で再試行）。

### 取り込み経路は3つあり、規則が同じではない

クラウドのデータが state に入る経路は3つ。**平常時だけ cloud-wins、残り2つは union（ローカル優先）**という非対称な構成なので、どの経路で何が起こりうるかを先に押さえること。

| 経路 | 契機 | 規則 | 失われうるもの |
|---|---|---|---|
| 初回取り込み | 起動後 idle の `fetchCloud`（1回） | `mergeCloudInitial`＝フィールド別ローカル優先（union） | 同日衝突で回数の**少ない方**（keep-larger の既知トレードオフ） |
| 復帰時 resync（#242） | `visibilitychange`→visible の `fetchCloud` | 同上（`reconcileInitialCloud`） | 同上。加えて union の副作用で**一方で外した装備・置物が復活**しうる |
| realtime | `onSnapshot`（以降ずっと） | `applyRemoteState` → `mergeCloud`＝**cloud-wins**（`CLOUD_FIELDS` をまるごと差し替え。自分の書き込みのエコーは差分比較でスキップ） | **まだ push していないローカルの変更**。`pushCloudDebounced` の待ち時間（既定2秒）内に他端末のスナップショットが届くと、その2秒ぶんの操作が消える |

> **設計判断**: realtime を cloud-wins のままにしているのは、平常時に union を使うと「一方の端末で外した装備が相手のスナップショットのたびに復活し続ける」ことになり操作が確定しないため。取りこぼすのは debounce 待ちの数秒ぶんだけで、記録確定時は `flushCloud()` で即送るので**記録そのものは落ちない**。フィールド別のタイムスタンプ／世代管理で本質的に解くのは #258（認証＋ルール）と合わせて別途。
>
> 逆に**初回 `fetchCloud` で cloud-wins を使うと**、idle 同期完了前にローカルで記録した内容を上書き（clobber）してしまう。そのため初回・復帰時だけ union に倒す。

### 初回取り込みのマージ（`mergeCloudInitial` ＝ ローカル優先）

`mergeCloudInitial(local, cloud)` が**フィールドごとにローカル優先**で突き合わせ、`recomputeState` で導出値を再計算してから反映・push する。

| フィールド | マージ規則 | 理由 |
|---|---|---|
| `sessions` | `mergeSessionsKeepLarger`: date をキーに 1 日 1 件へ解決。両側にあれば `totalCount` の**大きい方**を採用（**合算しない**）。並びは date 降順、同回数の tie はローカル優先。ただし `bonusCoins`（#148）は衝突時に双方の **max** を救済 | sessions は date 一意。合算すると部分同期後の共有ベースを二重計上し、コイン/XP が恒久的に水増しされる。record ID/vector clock が無い前提での安全側。`bonusCoins` は totalCount から導出されない当選値なので keep-larger で消さず max で残す |
| `inventory` | 重複 ID を除いた **union** | 所有は単調増加 |
| `pet.equippedItems` | union のうち、マージ後 `inventory` に含まれるものだけ | 未所持の装備を残さない |
| `pet.placedItems` | 同上（#226） | 未所持の置物の配置を残さない |
| `pet.itemLayout` | **union**（cloud 土台にローカル上書き・#242） | placedItems だけ union して座標をローカル固定だと、他端末で置いた置物が既定位置に戻る |
| `pet.affinity` / `pet.foodSpent` | **max** | sessions から導出されない累積値 |
| `pet.coins` / `pet.xp` / `pet.level` / `streak` / `badges` | マージ後の `sessions` から `recomputeState` で再計算 | sessions が唯一の正。`spent = spentCoins(merged inventory) + pet.foodSpent` を第2引数に渡す |

マージ結果がクラウドと異なれば（ローカルだけが持つ記録があった等）`pushCloud` で確定する。

> **設計判断（topic_1780534255497 で合意）**: 同日衝突は「合算」ではなく **keep-larger**。無損失（合算）より**経済水増しの回避**を優先した——水増しは不可逆で気づきにくく、ゲーム経済（コイン/レベル/ストリーク）の整合を壊す。朝スマホ・夜タブレットで別端末・同日記録という稀ケースでは小さい方を失うが、これは record ID 不在ゆえの曖昧さで、合算するには ID か vector clock の導入（#142 スコープ外）が要る。

> **設計判断（#242・復帰時の丸ごと上書き対策）**
> - `pushCloud` は `setDoc`（merge無し＝doc丸ごと置換）、realtime の `mergeCloud` は `pet` をフィールドごと cloud-wins で差し替える
> - iOS PWA 等はサスペンド中 `onSnapshot` が届かない。**復帰直後の古い in-memory state のまま操作すると、その古い `pet` が `placedItems`/`itemLayout` ごとクラウドを上書きし、他端末で配置した置物が消える**
> - 対策：`visibilitychange`→visible で `fetchCloud` →**非破壊 union マージ**（`reconcileInitialCloud`＝`mergeCloudInitial` 経路）。最新の配置を取り込んでから操作・push を受ける（差分なしなら getDoc 1回で no-op）
> - union の副作用（一方で外した装備の復活）は初回同期と同じ既知トレードオフ。本筋の field 別タイムスタンプ/世代管理は #258 と合わせて別途

### 書き込みの遅延バッチコミット（`pushCloudDebounced` / `flushCloud`・#146）

`commitState` はローカルへ即時保存し、クラウドへは `pushCloudDebounced`（既定 2000ms）で送る。debounce 中は最新データだけを保持し、スタンプ連打・購入・えさやりの連続操作を **1 回の Firestore 書き込みにまとめる**。確定が必要な境界では `flushCloud()` で即送信する：

| 契機 | 動作 |
|---|---|
| 記録の確定（`submitRecord`） | `commitState` 直後に `flushCloud()`。記録はバッチ境界なので debounce を待たず確実に送る |
| タブ非アクティブ（`visibilitychange`→hidden）／離脱（`pagehide`） | `flushCloud()` で保留分を確定。バックグラウンド化・タブ閉じで未送信を取りこぼさない |

> **設計判断**: ローカル保存は従来どおり即時（オフラインキャッシュ・損失なし）で、遅延させるのはクラウド送信のみ。debounce を延ばすほど書き込みは減るが反映が遅れるため、ライフサイクル境界での `flushCloud()` を必須経路にして「まとめつつ取りこぼさない」を両立する。

## バックアップ/復元・初期化（[js/backup.js](../js/backup.js)・#140 / #183）

認証なし・匿名同期のため、端末故障やブラウザデータ削除でデータが消えうる。親が state を JSON で手元に保存し、いつでも復元できる安全弁（純粋関数中心）。UI の配置と文言は [features.md](./features.md)。

**ファイル形式**：state そのままではなく識別マーカー付きでラップする。ファイル名は `piano-pet-backup-YYYY-MM-DD.json`。`exportState(state)` が文字列化を担い、Blob 化とダウンロードは [app.js](../js/app.js) 側。

```json
{
  "app": "piano-pet",
  "schemaVersion": 2,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "state": { /* loadState() と同じ state オブジェクト（version 含む） */ }
}
```

**復元時の検証（`parseBackup(text)`）**：`{ok:true, state}` か `{ok:false, reason}` を返す。

| reason | 条件 |
|---|---|
| `parse` | JSON として壊れている |
| `marker` | `app !== 'piano-pet'`（別アプリ・マーカー無し） |
| `shape` | 必須キー `state.pet` / `state.streak` が欠落・配列（クラッシュ防止の最小スキーマ検証）／`sessions`・`inventory`・`badges` が配列でない（#272） |
| `future` | `schemaVersion` が現行より大きい（ダウングレード破損防止） |

検証を通った場合のみ `migrate()` → `normalizeState()` を適用して現行スキーマに整える。

**復元フローとクラウド整合（重要）**：`importState` は明示的な上書き操作。realtime 購読中に取り込むと、push が反映される前に**古いスナップショットが `onSnapshot` で降ってきて取り込み結果を巻き戻す**競合が起きうる。これを断つため app.js は次の順で行う（topic_1780530736889 で合意）:

1. 復元直前の現行 localStorage を `piano-pet-backup-before-restore` へ自動退避（誤読込からの復旧用）。
2. 保持しておいた cloud 購読解除ハンドル（`cloudUnsub`）を実行して **onSnapshot を一時解除**。
3. `saveState(imported)` でローカル反映。
4. `await pushCloud(cloudFields(imported))` で**クラウド反映の完了を待つ**。
5. `window.location.reload()` でクリーン再起動。リロード後の `fetchCloud()` は push 済みデータを返すため巻き戻しは起きない。

> **設計判断**: 購読を解除せず差分比較だけに頼ると、import 直後の旧スナップショットが `mergeCloud` で取り込み結果を上書きしうる。`cloudUnsub` の保持＋push 完了待ち＋reload の三段で競合を物理的に排除する。オフライン時は `pushCloud` が早期 return するが、ローカルには取り込み済みが残り次回オンライン同期で送られる。

**データ初期化（`resetData`・#183）**：復元と**同一の5段手順**で、取り込み対象が `normalizeState({})`（新品の `DEFAULTS`）になるだけ。直前データの退避も行うため誤って押しても復旧できる。`settings` 等の端末ローカル値も既定へ戻る。

> **設計判断（#183）**: UI リセットと Firestore 直削除で未決だったが、親が端末側で完結できる UI を採用。復元と安全手順を共有して実装を最小（クラウド競合対策・退避を再利用）に収め、専用ナビ画面も増やさず親ゲート内へ同居させた。

## マルチアカウント（アカウント分離・#182）

検証用と実運用でデータを分ける。認証は導入せず、**読み書きする Firestore doc と localStorage キーをアカウント単位で名前空間化する**だけの最小構成。純粋ロジックは [js/account.js](../js/account.js)、UI は親ゲート内の「アカウント」セクション。

- **既定アカウント**：娘（`id: 'data'`）／テスト用（`id: 'test'`）の2つ。`piano-pet:accounts` に有効アカウントと一覧を持つ（端末ローカル・クラウド非同期）。
- **名前空間**：localStorage は `storageKeyFor(id)`、Firestore doc は `cloudDocIdFor(id)` で導出。`id: 'data'` は既存の保存先（localStorage `piano-pet`・doc `pianopet/data`）をそのまま指すため、**本機能導入で娘の既存データは一切移動しない**（後方互換）。
- **切替**：親ゲートの裏で `setActiveAccount(id)` → `window.location.reload()`。リロード後に storage の参照キーと cloud の購読 doc が新アカウントで貼り直される（import/reset と同じリロード方式）。`cloud.js` は doc を import 時の有効アカウントで固定するが、切替が必ずリロードを伴うため整合する。

> **設計判断（#182）**: Firebase 匿名/Google 認証で `users/{uid}` にネストする案もあったが、piano-pet は「認証なし・Firestore ルールでアクセス制御」で dtask プロジェクト（`dtask-d08b6`）を間借りしている。認証導入は共有プロジェクトとデータ構造への影響が大きいため、**家庭内ツール前提**でドキュメント切替に倒した。誰でも全アカウントを見られるが、子の切替は親ゲートで防ぐ。
>
> **前提（Firestore ルール）**: テスト用アカウントは `pianopet/test` を読み書きするため、ルールが `pianopet` コレクション全体（doc ワイルドカード）を許可している必要がある。`pianopet/data` 限定だとテスト用 doc への書き込みが拒否され、ローカルのみ動作になる（`pushCloud` は失敗を握りつぶす）。

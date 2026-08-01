# データモデル（設計書）

> **スキーマ・マージ規則・永続化の正本**。要件は [requirements.md](./requirements.md)、画面と機能のふるまいは [features.md](./features.md)。
> **更新ルール**: `apps/piano-pet/` のソースを変更したら関連docsへ必ず反映する（[CLAUDE.md](../../../CLAUDE.md)）。

piano-pet の状態は localStorage に JSON オブジェクトとして保存される。保存キーは**有効アカウント**（マルチアカウント・#182）から導出され、既定（娘）は従来どおり `piano-pet`、テスト用は `piano-pet:test`。読み込み・正規化・クラウド射影はすべて [js/storage.js](../js/storage.js) に集約されている（キー導出は [js/account.js](../js/account.js) `storageKeyFor`）。

## State スキーマ (v1)

| フィールド | 型 | クラウド同期 | 説明 |
|---|---|:---:|---|
| `version` | number | − | スキーマバージョン。現行 `1`。端末ローカルのみ |
| `pet` | Pet | ✓ | ペット本体 |
| `inventory` | string[] | ✓ | 購入済みショップアイテムID |
| `streak` | Streak | ✓ | 連続練習記録 |
| `badges` | string[] | ✓ | 獲得バッジID |
| `sessions` | Session[] | ✓ | 練習セッション履歴（XP/レベル等の計算元） |
| `settings` | Settings | − | 端末ローカル設定（音など）。クラウド非同期 |

クラウド（Firestore `pianopet/<doc ID>`）に載るのは `CLOUD_FIELDS`（`pet, inventory, streak, badges, sessions`）のみ。doc ID は [account.js](../js/account.js) `cloudDocIdFor`（[cloud.js](../js/cloud.js) が import 時に束縛）で導出する。`settings` と `version` は端末ローカルに留まる。

旧 `assignment`（しゅくだい・#143）は機能削除（#261）で同期対象から外した。既存データに残る値は `normalizeState` の未知キー引き継ぎで無害に残り、クラウド doc からは次回 push（setDoc 置換）で自然に消える。旧 `Assignment` スキーマ・LWW マージ（`pickNewerAssignment`）・関連 UI はコードから消えている。

### doc ID の推測不能化（がぞくコード・#233 段階1）

旧仕様は doc ID が固定・推測可能（既定=`pianopet/data`／テスト用=`pianopet/test`）だった。Firebase config はクライアント埋め込みの公開情報なので、**認証なしの現構成では第三者が到達できる構造的リスク**がある。段階1として doc ID を初回生成のランダム値（**がぞくコード** `pp-<uuid>`）に置き換える。

| 項目 | 内容 |
|---|---|
| 保存 | 端末ローカル `piano-pet:cloud-ids`（`{ [アカウントID]: コード }`）。**クラウドには載せない** |
| 未移行時 | `cloudDocIdFor` は旧固定IDへフォールバック＝**移行するまで挙動は変わらない**（後方互換） |
| 移行 | 親ゲート内の明示操作。①ローカルへ自動退避（`piano-pet-backup-before-migrate`）②コード生成 ③新 doc へ現行データをコピー ④コード保存 ⑤リロード |
| 複数端末 | 他端末は**コード入力**、またはコードを同梱したバックアップJSON（#140）の取り込みで同じ doc に合流。合流後の初回同期は union マージ（`mergeCloudInitial`）なのでローカルデータは消えない |
| 旧 doc | 移行しても自動では消さない。全端末の合流後に親が明示操作で空にする（`ふるい ばしょを からにする`） |
| アカウント分離 | コードはアカウント単位なので #182 の分離は維持 |

> **設計判断（#233 段階1）**: **自動移行にしない**。端末ごとに別コードが生成されると家族の共有 doc が割れて同期が壊れるため、移行は親の明示操作にし、他端末はコード共有で合流させる。また旧 doc に「新しい doc への転送先」を書き置く案は、旧 ID を知る第三者がそこから新 ID へ到達できてしまい受け入れ基準（推測しても到達できない）を満たさないため不採用＝コードは**帯域外（コード表示／バックアップJSON）で共有**する。**本命の匿名認証＋セキュリティルールは段階2**（別Issue）：匿名認証は端末ごとに UID が異なるため「自分の UID 配下のみ許可」ルールにすると複数端末共有が壊れる＝クレデンシャル引き継ぎか実アカウント認証（Google等）の設計が別途必要。なおセキュリティルール自体は間借り元 `dtask-d08b6` の Firebase コンソール管理（リポジトリ外・dtask にも影響）。

### State 以外の localStorage キー（端末ローカル・クラウド非同期）

| キー | 値 | 用途 |
|---|---|---|
| `piano-pet-onboarded` | `'1'` | 初回オンボーディング（紙芝居・#141）を見たか。端末ごとに案内するため state に含めない（[onboarding.js](../js/onboarding.js)）。アカウント横断で共有 |
| `piano-pet:accounts` | `{ active, accounts: [{id,name}] }` | マルチアカウント（#182）の有効アカウントと一覧（[account.js](../js/account.js)）。壊れていれば既定2アカウント（娘=`data`／テスト用=`test`）にフォールバック |
| `piano-pet:cloud-ids` | `{ [アカウントID]: コード }` | がぞくコード（#233・上記） |
| `piano-pet-backup-before-restore` | State JSON | 復元・初期化の直前に現行 state を退避（`RESTORE_BACKUP_KEY`・#140/#183） |
| `pp-theme` | `'light'` \| `'dark'` | 画面のあかるさ（#151）。`auto` は保存せず属性を付けない |
| `<アカウントキー>:stamp-draft` | `{ date, stamps: string[] }` | 当日のスタンプ下書き。ホーム戻り→記録再開でカードを引き継ぐ（#164）。打鍵ごとに保存。**初回記録前のみの引き継ぎ用**で、記録確定後は当日セッションが正となり記録画面はセッションから復元する（#186）。読み出し時に `date !== todayStr()` なら破棄。**アカウントごとに分離** |

### Session

1件＝「ある日付の練習記録」。XP・レベル・コイン・ストリーク・バッジの**唯一の計算元**で、編集・削除時は `recomputeState` がこの配列だけから全状態を再構築する。生成は [game.js](../js/game.js) `applySession`、曲の集約は [record-form.js](../js/record-form.js) `collectSongs`。

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

> **設計判断（きょうのおまけ #148 のコイン永続）**: コインは `sessions` から `recomputeState` で全再計算される派生値のため、乱数ボーナスをそのまま足すと再計算で消える。別アキュムレータではなく**記録への保存値（`bonusCoins`）**で解決した。抽選は app.js 側（`rollDailyBonus(Math.random())`）でその日の初回記録時のみ行い、結果を `applySession(state, session, bonusCoins)` に渡して記録へ焼き込む。`recomputeState` は `s.bonusCoins` を `earned` に再加算するため、編集・削除・クラウドマージ後も再抽選されず金額が保たれる。`game.js` は純粋なまま（乱数は注入）。

### 派生データ（保存しない）

保存フィールドを持たず `sessions` / `pet.affinity` から都度導出する。**解放済みフラグ類を持たない**のは、二重管理になり `recomputeState`（全再計算）との整合リスクが生じるため。

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

## マイグレーション戦略

破壊的なスキーマ変更（フィールドの削除・改名、ネスト構造の変更、配列要素の形式変更など）に備え、state にバージョン番号を埋め込み、読み込み時に順次マイグレーションを適用する。

- `SCHEMA_VERSION`（storage.js）が現行バージョン。state の `version` に保存される。
- `MIGRATIONS[n]` は **v(n) の state を v(n+1) の形に変換する純粋関数**。
- `migrate(saved)` が保存データの `version` を現行まで順に引き上げる。`version` を持たない旧データは **v0** とみなし、現行より新しいデータ（ダウングレード時）は**バージョンを下げず**そのまま返す。
- 読み込みフローは `loadState()` → `migrate()` → `normalizeState()`（移行で構造を整えた後にデフォルト補完）。

**スキーマを変更する手順**：①`DEFAULTS` を更新 →②`SCHEMA_VERSION` を +1 →③`MIGRATIONS` 末尾に「直前バージョン → 新バージョン」の変換関数を追加（入力を破壊せず返す。`version` の付与は `migrate()` が行う）→④`tests/storage.test.js` に移行テストを追加 →⑤本書の表とバージョンを更新。

```js
// v1 → v2: streak.freezes を廃止し maxFreezes に改名する場合
export const SCHEMA_VERSION = 2;
const MIGRATIONS = [
  (s) => s,                                    // v0 → v1
  (s) => ({ ...s, streak: { ...s.streak, maxFreezes: s.streak?.freezes ?? 0 } }),
];
```

**クラウド側の制約**：Firestore のデータには `version` を含めていない（`CLOUD_FIELDS` 外）。各端末は読み込み時に自分のローカルコピーをマイグレーションする。現状の `mergeCloud(local, cloud)` はクラウドデータに `migrate()` を適用せず `normalizeState` の補完のみで取り込むため、**クラウド同期対象フィールド（`sessions` 等）の構造を破壊的に変更するマイグレーションを追加する場合**は `mergeCloud` 内でも取り込み前に移行処理を適用する必要がある。

## 起動シーケンスとクラウド同期（ローカルファースト・#142）

1. `loadState()`（localStorage）→ `renderHome()` を**同期実行**（最初の描画はクラウドを待たない）。
2. クラウド同期の起動（`initCloudSync`）は **`requestIdleCallback`**（非対応環境は `setTimeout`）で**アイドル時間まで遅延**。Firebase SDK の動的 import（CDN 取得）と初期化はこの時点で初めて走り、初回描画・操作と競合しない。
3. オフライン等で SDK 取得に失敗してもローカル動作は妨げない（`online` 復帰で再試行）。

### 初回取り込みのマージ（`mergeCloudInitial` ＝ ローカル優先）

realtime の `onSnapshot` 経路（`applyRemoteState` → `mergeCloud`）は **cloud-wins**（自分の書き込みのエコーは差分比較でスキップ）。一方、**初回 `fetchCloud` の取り込み**で cloud-wins を使うと、idle 同期完了前にローカルで記録した内容を上書き（clobber）してしまう。これを防ぐため初回のみ `mergeCloudInitial(local, cloud)` で**フィールドごとにローカル優先**で突き合わせ、`recomputeState` で導出値を再計算してから反映・push する。

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

> **設計判断**（Antigravity との設計レビュー topic_1780534255497 で合意）: 同日衝突の「合算 vs keep-larger」は、無損失（合算）よりも**経済水増しの回避（keep-larger）**を優先した。水増しは不可逆で気づきにくく、ゲーム経済（コイン/レベル/ストリーク）の整合を壊すため。朝スマホ・夜タブレットで別端末・同日記録という稀ケースでは小さい方を失うが、これは record ID 不在ゆえの既存の一般同期の曖昧さであり、合算するには ID か vector clock の導入（#142 スコープ外）が要る。

> **設計判断（#242・復帰時の丸ごと上書き対策）**: `pushCloud` は `setDoc`（merge無し＝doc丸ごと置換）、realtime の `mergeCloud` は `pet` をフィールドごと cloud-wins で差し替える。iOS PWA 等はサスペンド中 `onSnapshot` が届かないため、**復帰直後の古い in-memory state のまま操作すると、その古い `pet` が `placedItems`/`itemLayout` ごとクラウドを上書きし、他端末で配置した置物が消える**。対策として `visibilitychange`→visible で `fetchCloud`→**非破壊 union マージ**（`reconcileInitialCloud`＝`mergeCloudInitial` 経路）を挟み、最新の配置を取り込んでから操作・push を受ける（差分なしなら getDoc 1回で no-op）。本筋の field 別タイムスタンプ/世代管理は #233（匿名認証＋ルール）と合わせて別途。union の副作用（一方で外した装備の復活）は初回同期と同じ既知トレードオフ。

### 書き込みの遅延バッチコミット（`pushCloudDebounced` / `flushCloud`・#146）

通常の保存（`commitState`）はローカルへ即時保存したうえで、クラウドへは `pushCloudDebounced`（既定 2000ms）で送る。debounce 中に届いた最新データだけを保持し、スタンプ連打・購入・えさやりなどの連続操作を **1 回の Firestore 書き込みにまとめる**。確定が必要な境界では `flushCloud()` で保留分を即送信する：

| 契機 | 動作 |
|---|---|
| 記録の確定（`submitRecord`） | `commitState` 直後に `flushCloud()`。記録はバッチ境界なので debounce を待たず確実に送る |
| タブ非アクティブ（`visibilitychange`→hidden）／離脱（`pagehide`） | `flushCloud()` で保留分を確定。バックグラウンド化・タブ閉じで未送信を取りこぼさない |

> **設計判断**: ローカル保存は従来どおり即時（オフラインキャッシュ・損失なし）で、遅延させるのはクラウド送信のみ。debounce を延ばすほど書き込みは減るが反映が遅れるため、ライフサイクル境界での `flushCloud()` を必須経路にして「まとめつつ取りこぼさない」を両立する。

## バックアップ/復元・初期化（[js/backup.js](../js/backup.js)・#140 / #183）

認証なし・匿名クラウド同期のため、端末故障やブラウザデータ削除でデータが消えるリスクがある。親が state を JSON ファイルで手元に保存し、いつでも復元できる安全弁を置く（純粋関数中心）。UI の配置と文言は [features.md](./features.md)。

**バックアップファイル形式**：state そのものではなく識別マーカー付きでラップする。ファイル名は `piano-pet-backup-YYYY-MM-DD.json`。`exportState(state)` が文字列化を担い、Blob 化とダウンロードは [app.js](../js/app.js) 側。

```json
{
  "app": "piano-pet",
  "schemaVersion": 1,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "state": { /* loadState() と同じ state オブジェクト（version 含む） */ }
}
```

**復元時の検証（`parseBackup(text)`）**：`{ok:true, state}` か `{ok:false, reason}` を返す。

| reason | 条件 |
|---|---|
| `parse` | JSON として壊れている |
| `marker` | `app !== 'piano-pet'`（別アプリ・マーカー無し） |
| `shape` | 必須キー `state.pet` / `state.streak` が欠落（クラッシュ防止の最小スキーマ検証） |
| `future` | `schemaVersion` が現行より大きい（ダウングレード破損防止） |

検証を通った場合のみ `migrate()` → `normalizeState()` を適用して現行スキーマに整える。

**復元フローとクラウド整合（重要）**：`importState` は明示的な上書き操作。realtime 購読中に取り込むと、push が Firestore に反映される前に**古いスナップショットが `onSnapshot` 経由で降ってきて取り込み結果を巻き戻す競合**が起きうる。これを断つため app.js は次の順で行う（設計レビュー topic_1780530736889 で合意）:

1. 復元直前の現行 localStorage を `piano-pet-backup-before-restore` へ自動退避（誤読込からの復旧用）。
2. 保持しておいた cloud 購読解除ハンドル（`cloudUnsub`）を実行して **onSnapshot を一時解除**。
3. `saveState(imported)` でローカル反映。
4. `await pushCloud(cloudFields(imported))` で**クラウド反映の完了を待つ**。
5. `window.location.reload()` でクリーン再起動。リロード後の `fetchCloud()` は push 済みデータを返すため巻き戻しは起きない。

> **設計判断**: 購読を解除せず差分比較だけに頼ると、import 直後の旧スナップショットが `mergeCloud` で取り込み結果を上書きしうる。`cloudUnsub` の保持＋push 完了待ち＋reload の三段で競合を物理的に排除する。オフライン時は `pushCloud` が早期 return するが、ローカルには取り込み済みが残り次回オンライン同期で送られる。

**データ初期化（`resetData`・#183）**：復元フローと**同一の5段手順**を踏み、取り込み対象が import した state ではなく `normalizeState({})`（新品の `DEFAULTS`）になるだけ。直前データの退避も同様に行うため、誤って押しても復旧できる。`settings` 等の端末ローカル値も既定に戻る。

> **設計判断（#183）**: UI リセットと Firestore 直削除のどちらにするか未決だったが、親が端末側で完結できる UI を採用。復元と安全手順を共有することで実装は最小（クラウド競合対策・退避を再利用）に収め、専用ナビ画面も増やさず既存の親ゲート内に同居させた。

## マルチアカウント（アカウント分離・#182）

検証用と実運用でデータを分けるための機能。認証（Firebase Auth）は導入せず、**読み書きする Firestore ドキュメントと localStorage キーをアカウント単位で名前空間化する**だけの最小構成。純粋ロジックは [js/account.js](../js/account.js)、UI は親ゲート内の「アカウント」セクション。

- **既定アカウント**：娘（`id: 'data'`）／テスト用（`id: 'test'`）の2つ。`piano-pet:accounts` に有効アカウントと一覧を持つ（端末ローカル・クラウド非同期）。
- **名前空間**：localStorage は `storageKeyFor(id)`、Firestore doc は `cloudDocIdFor(id)` で導出。`id: 'data'` は既存の保存先（localStorage `piano-pet`・doc `pianopet/data`）をそのまま指すため、**本機能導入で娘の既存データは一切移動しない**（後方互換）。
- **切替**：親ゲートの裏で `setActiveAccount(id)` → `window.location.reload()`。リロード後に storage の参照キーと cloud の購読 doc が新アカウントで貼り直される（import/reset と同じリロード方式）。`cloud.js` は doc を import 時の有効アカウントで固定するが、切替が必ずリロードを伴うため整合する。

> **設計判断**: Issue では Firebase 匿名/Google 認証で `users/{uid}` にネストする案も挙がったが、piano-pet は元々「認証なし・Firestore ルールでアクセス制御」の設計で、dtask プロジェクト（`dtask-d08b6`）を間借りしている。認証導入は共有プロジェクトとデータ構造への影響が大きいため、**家庭内ツール前提**で認証なしのドキュメント切替に倒し、実装と影響範囲を最小化した。誰でも全アカウントを見られるが、子の切替は親ゲートで防ぐ。
>
> **前提（Firestore ルール）**: テスト用アカウントは `pianopet/test` を読み書きするため、ルールが `pianopet` コレクション全体（doc ワイルドカード）を許可している必要がある。`pianopet/data` 限定だとテスト用 doc への書き込みが拒否され、ローカルのみ動作になる（`pushCloud` は失敗を握りつぶす）。

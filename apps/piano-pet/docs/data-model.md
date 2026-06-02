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
| `settings` | Settings | − | 端末ローカル設定（音など）。クラウド非同期 |

クラウド (Firestore `pianopet/data`) に載るのは `CLOUD_FIELDS`（`pet, inventory, streak, badges, sessions`）のみ。
`settings` と `version` は端末ローカルに留まる。

### Session
1件＝「ある日付の練習記録」。XP・レベル・コイン・ストリーク・バッジの**唯一の計算元**で、編集・削除時は `recomputeState` がこの配列だけから全状態を再構築する。生成は [game.js](../js/game.js) `applySession`、曲の集約は [record-form.js](../js/record-form.js) `collectSongs`。

| フィールド | 型 | 説明 |
|---|---|---|
| `date` | `YYYY-MM-DD` | 練習したローカル暦日。同一日付は記録時に1件へ統合（`mergeSameDaySessions`） |
| `songs` | `Song[]` | 曲ごとの回数リスト（空名・0回以下は除外済み） |
| `totalCount` | number | その日の合計回数（`songs` の `count` 合計） |
| `coinsEarned` | number | その記録で得たコイン（再計算で都度上書き。表示・参照用） |
| `xpEarned` | number | その記録で得たXP（同上） |

### Song
| フィールド | 型 | 説明 |
|---|---|---|
| `name` | string | 曲名（前後空白はトリム済み） |
| `count` | number | その曲の回数（正の整数） |

### 派生データ（保存しない）

- **曲の色**（#122）：曲名から決定的ハッシュで色相を算出する（[song-color.js](../js/song-color.js) `songColor`）。保存しないので `sessions` さえ同じならどの端末でも同じ色。スキーマ非依存。
- **曲別の累計回数**（#122）：`sessions` から再集計する（[record-form.js](../js/record-form.js) `songTotals`）。専用フィールドは持たない。
- **なかよしレベルとご褒美解放**（#124）：`pet.affinity` のしきい値から決定的に導出する（[feed.js](../js/feed.js) `affinityLevel` / `affinityRewards`）。**解放済みフラグは持たない**。`recomputeState` は `pet.affinity` を保持するため、記録の編集・削除（全再計算）でも解放状態が矛盾しない。> **設計判断**: Issue では「解放済みフラグを `pet` に追加」案だったが、affinity 自体が単調増加で永続化済みのため、フラグを別持ちすると二重管理になり再計算との整合リスクが生じる。affinity からの導出に一本化した。

### Pet
| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | string | `'きーちゃん'` | 猫の名前 |
| `level` | number | `1` | XPから算出される現在レベル |
| `xp` | number | `0` | 累計経験値 |
| `coins` | number | `0` | 所持コイン（= 獲得総額 − 装備購入 − えさ消費）。記録の編集・削除時の全再計算（`recomputeState`）では `Math.max(0, 獲得総額 − spent)` で再導出する。`spent` ＝ 装備購入総額（`spentCoins`＝インベントリ価格合計）＋ `foodSpent` の合算で、[app.js](../js/app.js) が算出して渡す（→ 購入・えさ消費分が再計算で復活しない） |
| `equippedItems` | string[] | `[]` | 装備中アイテムID（スロットごとに1つ） |
| `affinity` | number | `0` | なかよし度（えさやりで上昇） |
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

正規化は `normalizeState(saved)` が担い、`pet`/`streak`/`settings` の不足キーを `DEFAULTS` で補完する。
フィールド追加程度であれば正規化のデフォルト補完だけで済むため、スキーマバージョンを上げる必要はない。

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

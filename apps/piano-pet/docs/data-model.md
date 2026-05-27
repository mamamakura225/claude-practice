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

### Pet
| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `name` | string | `'きーちゃん'` | 猫の名前 |
| `level` | number | `1` | XPから算出される現在レベル |
| `xp` | number | `0` | 累計経験値 |
| `coins` | number | `0` | 所持コイン（= 獲得総額 − 装備購入 − えさ消費） |
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

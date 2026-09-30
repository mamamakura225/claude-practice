/* 未同期（クラウド未読込・オフライン）中のローカル変更を、後から届いたクラウド最新へ載せ直す。
 * baseline: 最後にクラウドと一致していた状態 / local: 現在のローカル状態 / cloud: 届いたクラウド状態。
 * baseline→local の差分だけを cloud に適用する。既存要素は「ローカルで値が変わったフィールドだけ」を重ねるので、
 * 並べ替えで order だけ変わった要素が他端末のタイトル・完了状態等を巻き戻すことはない。 */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changedKeys(baseItem, localItem) {
  const keys = new Set([...Object.keys(baseItem), ...Object.keys(localItem)]);
  return [...keys].filter(k => !same(baseItem[k], localItem[k]));
}

export function mergeFallbackChanges(baseline, local, cloud) {
  const base = new Map((baseline || []).map(x => [x.id, x]));
  const localIds = new Set((local || []).map(x => x.id));
  const edits = new Map(); // id -> 変更フィールド名（既存要素）
  const added = [];        // baseline に無い要素（丸ごとローカル版）
  for (const x of local || []) {
    const b = base.get(x.id);
    if (!b) { added.push(x); continue; }
    const keys = changedKeys(b, x);
    if (keys.length) edits.set(x.id, { item: x, keys });
  }
  const deleted = new Set([...base.keys()].filter(id => !localIds.has(id)));

  const overlay = (c) => {
    const e = edits.get(c.id);
    if (!e) return c;
    const out = { ...c };
    for (const k of e.keys) {
      if (k in e.item) out[k] = e.item[k];
      else delete out[k];
    }
    return out;
  };

  const cloudIds = new Set((cloud || []).map(x => x.id));
  const addedIds = new Set(added.map(x => x.id));
  const items = [
    ...(cloud || []).filter(x => !deleted.has(x.id) && !addedIds.has(x.id)).map(overlay),
    // クラウドで削除済みでもローカルで編集した要素は、消えない側に倒して残す
    ...[...edits.values()].filter(e => !cloudIds.has(e.item.id)).map(e => e.item),
    ...added,
  ];
  return { items, hasLocalChanges: edits.size > 0 || added.length > 0 || deleted.size > 0 };
}

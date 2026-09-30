/* フォールバック（クラウド未読込）中のローカル変更を、後から届いたクラウド最新へ載せ直す。
 * baseline: フォールバック起動時にローカルから読んだ状態 / local: 現在のローカル状態 / cloud: 届いたクラウド状態。
 * baseline→local の差分（追加・編集・削除）だけを cloud に適用し、触っていない要素はクラウド側を正とする。 */
export function mergeFallbackChanges(baseline, local, cloud) {
  const base = new Map((baseline || []).map(x => [x.id, JSON.stringify(x)]));
  const localIds = new Set((local || []).map(x => x.id));
  const changed = new Map(
    (local || []).filter(x => base.get(x.id) !== JSON.stringify(x)).map(x => [x.id, x])
  );
  const deleted = new Set([...base.keys()].filter(id => !localIds.has(id)));

  const cloudIds = new Set((cloud || []).map(x => x.id));
  const items = [
    ...(cloud || []).filter(x => !deleted.has(x.id)).map(x => changed.get(x.id) || x),
    ...[...changed.values()].filter(x => !cloudIds.has(x.id)),
  ];
  return { items, hasLocalChanges: changed.size > 0 || deleted.size > 0 };
}

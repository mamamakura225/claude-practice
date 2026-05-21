// ===== 練習記録フォームの純粋ロジック =====

// 入力行（{ name, count } の配列）を記録用ペイロードに集約する。
// - 曲名が空、または回数が0以下の行は除外
// - 曲名は前後の空白を落とす
// - 回数は整数に丸め、負数は0扱いで除外
export function collectSongs(rows) {
  const songs = [];
  for (const row of rows) {
    const name = String(row?.name ?? '').trim();
    const count = Math.floor(Number(row?.count));
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    songs.push({ name, count });
  }
  const totalCount = songs.reduce((sum, s) => sum + s.count, 0);
  return { songs, totalCount };
}

// 記録可能かどうかの判定。合計0回（有効な行なし）は不可。
export function isValidSession({ totalCount }) {
  return totalCount > 0;
}

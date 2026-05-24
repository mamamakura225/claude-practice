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

// スタンプカード方式：押した順の曲名配列を {songs, totalCount} に集約する。
// - 同じ曲は count を合算し、最初に押した順序を保持する
// - 空文字・空白のみは無視する
export function stampsToSongs(stamps) {
  const order = [];
  const counts = new Map();
  for (const raw of stamps ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    if (!counts.has(name)) order.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const songs = order.map((name) => ({ name, count: counts.get(name) }));
  const totalCount = songs.reduce((sum, s) => sum + s.count, 0);
  return { songs, totalCount };
}

// 既存セッションの songs を押した順スタンプ配列に展開する（編集時の復元用）。
// count 個ぶん曲名を並べる。無効な行（空名・0以下）は除外。
export function songsToStamps(songs) {
  const stamps = [];
  for (const song of songs ?? []) {
    const name = String(song?.name ?? '').trim();
    const count = Math.floor(Number(song?.count));
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    for (let i = 0; i < count; i += 1) stamps.push(name);
  }
  return stamps;
}

// 過去のセッションから曲名候補を「よく弾く順（合計回数）→新しさ」で返す。
// 曲選択チップのサジェストに使う。limit 件まで。
export function pastSongNames(sessions, limit = 8) {
  const counts = new Map();
  const lastSeen = new Map();
  let order = 0;
  for (const session of sessions ?? []) {
    order += 1;
    for (const song of session?.songs ?? []) {
      const name = String(song?.name ?? '').trim();
      if (!name) continue;
      const count = Math.floor(Number(song?.count)) || 0;
      counts.set(name, (counts.get(name) ?? 0) + Math.max(count, 1));
      lastSeen.set(name, order);
    }
  }
  return [...counts.keys()]
    .sort((a, b) => (counts.get(b) - counts.get(a)) || (lastSeen.get(b) - lastSeen.get(a)))
    .slice(0, limit);
}

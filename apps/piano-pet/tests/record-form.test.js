import { describe, it, expect } from 'vitest';
import {
  collectSongs,
  isValidSession,
  stampsToSongs,
  songsToStamps,
  pastSongNames,
  songTotals,
  isSongMaster,
  SONG_MASTER_COUNT,
} from '../js/record-form.js';

describe('collectSongs', () => {
  it('有効な行を {songs, totalCount} に集約する', () => {
    const result = collectSongs([
      { name: 'きらきら星', count: 5 },
      { name: 'ちょうちょ', count: 3 },
    ]);
    expect(result.songs).toEqual([
      { name: 'きらきら星', count: 5 },
      { name: 'ちょうちょ', count: 3 },
    ]);
    expect(result.totalCount).toBe(8);
  });

  it('曲名が空の行は除外する', () => {
    const result = collectSongs([
      { name: '', count: 5 },
      { name: '   ', count: 2 },
      { name: 'ちょうちょ', count: 3 },
    ]);
    expect(result.songs).toEqual([{ name: 'ちょうちょ', count: 3 }]);
    expect(result.totalCount).toBe(3);
  });

  it('回数が0以下・非数値の行は除外する', () => {
    const result = collectSongs([
      { name: 'A', count: 0 },
      { name: 'B', count: -2 },
      { name: 'C', count: '' },
      { name: 'D', count: 'abc' },
      { name: 'E', count: 4 },
    ]);
    expect(result.songs).toEqual([{ name: 'E', count: 4 }]);
    expect(result.totalCount).toBe(4);
  });

  it('文字列の回数は整数に変換する', () => {
    const result = collectSongs([{ name: 'A', count: '7' }]);
    expect(result.songs).toEqual([{ name: 'A', count: 7 }]);
    expect(result.totalCount).toBe(7);
  });

  it('小数の回数は切り捨てる', () => {
    const result = collectSongs([{ name: 'A', count: 3.9 }]);
    expect(result.songs[0].count).toBe(3);
  });

  it('曲名の前後の空白を落とす', () => {
    const result = collectSongs([{ name: '  ねこふんじゃった  ', count: 1 }]);
    expect(result.songs[0].name).toBe('ねこふんじゃった');
  });

  it('全行が無効なら空配列・合計0', () => {
    expect(collectSongs([{ name: '', count: 0 }])).toEqual({ songs: [], totalCount: 0 });
    expect(collectSongs([])).toEqual({ songs: [], totalCount: 0 });
  });
});

describe('isValidSession', () => {
  it('合計1回以上なら有効', () => {
    expect(isValidSession({ totalCount: 1 })).toBe(true);
    expect(isValidSession({ totalCount: 10 })).toBe(true);
  });

  it('合計0回は無効', () => {
    expect(isValidSession({ totalCount: 0 })).toBe(false);
  });
});

describe('stampsToSongs', () => {
  it('押した順の曲名を曲ごとに集約する', () => {
    const result = stampsToSongs(['きらきら星', 'ちょうちょ', 'きらきら星']);
    expect(result.songs).toEqual([
      { name: 'きらきら星', count: 2 },
      { name: 'ちょうちょ', count: 1 },
    ]);
    expect(result.totalCount).toBe(3);
  });

  it('最初に押した順序を保持する', () => {
    const result = stampsToSongs(['B', 'A', 'B', 'A']);
    expect(result.songs.map((s) => s.name)).toEqual(['B', 'A']);
  });

  it('空文字・空白のみのスタンプは無視する', () => {
    const result = stampsToSongs(['', '  ', 'A']);
    expect(result.songs).toEqual([{ name: 'A', count: 1 }]);
    expect(result.totalCount).toBe(1);
  });

  it('空配列・未定義は空集約', () => {
    expect(stampsToSongs([])).toEqual({ songs: [], totalCount: 0 });
    expect(stampsToSongs(undefined)).toEqual({ songs: [], totalCount: 0 });
  });

  it('collectSongs と互換な形を返す（合計が一致）', () => {
    const { totalCount } = stampsToSongs(['A', 'A', 'B']);
    expect(isValidSession({ totalCount })).toBe(true);
  });
});

describe('songsToStamps', () => {
  it('count 個ぶん曲名を並べる', () => {
    expect(songsToStamps([{ name: 'A', count: 2 }, { name: 'B', count: 1 }]))
      .toEqual(['A', 'A', 'B']);
  });

  it('stampsToSongs と往復しても集約結果が一致する', () => {
    const songs = [{ name: 'きらきら星', count: 3 }, { name: 'ちょうちょ', count: 2 }];
    expect(stampsToSongs(songsToStamps(songs)).songs).toEqual(songs);
  });

  it('無効な行（空名・0以下）は除外する', () => {
    expect(songsToStamps([{ name: '', count: 3 }, { name: 'A', count: 0 }, { name: 'B', count: 1 }]))
      .toEqual(['B']);
  });
});

describe('pastSongNames', () => {
  it('合計回数の多い順に返す', () => {
    const sessions = [
      { songs: [{ name: 'A', count: 1 }, { name: 'B', count: 5 }] },
      { songs: [{ name: 'A', count: 1 }] },
    ];
    expect(pastSongNames(sessions)).toEqual(['B', 'A']);
  });

  it('同数なら新しく弾いた曲を優先する', () => {
    const sessions = [
      { songs: [{ name: 'A', count: 1 }] },
      { songs: [{ name: 'B', count: 1 }] },
    ];
    expect(pastSongNames(sessions)).toEqual(['B', 'A']);
  });

  it('重複曲名は1件にまとめる', () => {
    const sessions = [{ songs: [{ name: 'A', count: 1 }, { name: 'A', count: 1 }] }];
    expect(pastSongNames(sessions)).toEqual(['A']);
  });

  it('limit 件で打ち切る', () => {
    const sessions = [{ songs: [
      { name: 'A', count: 5 }, { name: 'B', count: 4 }, { name: 'C', count: 3 },
    ] }];
    expect(pastSongNames(sessions, 2)).toEqual(['A', 'B']);
  });

  it('セッションなしは空配列', () => {
    expect(pastSongNames([])).toEqual([]);
    expect(pastSongNames(undefined)).toEqual([]);
  });

  it('limit=Infinity で全曲を返す（datalist補完用）', () => {
    const songs = Array.from({ length: 12 }, (_, i) => ({ name: `曲${i}`, count: 12 - i }));
    const all = pastSongNames([{ songs }], Infinity);
    expect(all).toHaveLength(12);
    expect(all[0]).toBe('曲0'); // count 最大が先頭
  });
});

describe('songTotals', () => {
  it('曲ごとの累計回数を多い順に返す', () => {
    const sessions = [
      { songs: [{ name: 'A', count: 2 }, { name: 'B', count: 5 }] },
      { songs: [{ name: 'A', count: 4 }] },
    ];
    expect(songTotals(sessions)).toEqual([
      { name: 'A', count: 6 },
      { name: 'B', count: 5 },
    ]);
  });

  it('同数なら新しく弾いた曲を優先する', () => {
    const sessions = [
      { songs: [{ name: 'A', count: 3 }] },
      { songs: [{ name: 'B', count: 3 }] },
    ];
    expect(songTotals(sessions).map((t) => t.name)).toEqual(['B', 'A']);
  });

  it('空名・回数なしは無視する', () => {
    const sessions = [{ songs: [{ name: ' ', count: 5 }, { name: 'A', count: 0 }, { name: 'B', count: 2 }] }];
    expect(songTotals(sessions)).toEqual([{ name: 'B', count: 2 }]);
  });

  it('セッションなしは空配列', () => {
    expect(songTotals([])).toEqual([]);
    expect(songTotals(undefined)).toEqual([]);
  });
});

describe('isSongMaster', () => {
  it('累計が閾値以上ならマスター（#149）', () => {
    expect(isSongMaster(SONG_MASTER_COUNT)).toBe(true);
    expect(isSongMaster(SONG_MASTER_COUNT + 10)).toBe(true);
  });

  it('閾値未満・無効値はマスターでない', () => {
    expect(isSongMaster(SONG_MASTER_COUNT - 1)).toBe(false);
    expect(isSongMaster(0)).toBe(false);
    expect(isSongMaster(undefined)).toBe(false);
  });
});

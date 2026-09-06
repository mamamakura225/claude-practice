import { describe, it, expect } from 'vitest';
import {
  collectSongs,
  isValidSession,
  stampsToSongs,
  songsToStamps,
  combineSongs,
  pastSongNames,
  songTotals,
  isSongMaster,
  SONG_MASTER_COUNT,
  PRAISE_STAMPS,
  normalizePraise,
  TEMPO_STAMPS,
  normalizeTempo,
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

describe('combineSongs', () => {
  it('同じ曲名を合算し、最初に現れた順序を保つ', () => {
    expect(combineSongs([
      { name: 'よるのおはなし', count: 1 },
      { name: 'きらきら星', count: 2 },
      { name: 'よるのおはなし', count: 2 },
    ])).toEqual([
      { name: 'よるのおはなし', count: 3 },
      { name: 'きらきら星', count: 2 },
    ]);
  });

  it('空名・0以下・空配列は除外して空配列を返す', () => {
    expect(combineSongs([{ name: '', count: 3 }, { name: 'A', count: 0 }])).toEqual([]);
    expect(combineSongs([])).toEqual([]);
    expect(combineSongs(undefined)).toEqual([]);
  });
});

describe('pastSongNames', () => {
  it('最終練習日の新しい順に返す（累計回数は問わない・#252）', () => {
    // A は累計6回だが最後に弾いたのは古い。B は累計1回でも直近に弾いた → B が先頭。
    const sessions = [
      { date: '2026-07-10', songs: [{ name: 'B', count: 1 }] },
      { date: '2026-07-01', songs: [{ name: 'A', count: 5 }] },
      { date: '2026-06-20', songs: [{ name: 'A', count: 1 }] },
    ];
    expect(pastSongNames(sessions)).toEqual(['B', 'A']);
  });

  it('最終練習日が同じなら累計回数の多い順（#252 タイブレーク）', () => {
    const sessions = [
      { date: '2026-07-10', songs: [{ name: 'A', count: 2 }, { name: 'B', count: 5 }] },
    ];
    expect(pastSongNames(sessions)).toEqual(['B', 'A']);
  });

  it('曲の最終練習日は全セッション横断で最新を採る（配列順に依存しない）', () => {
    // 配列は古い順で来ても、A の最終日 07-15 が B の 07-10 より新しいので A が先頭。
    const sessions = [
      { date: '2026-07-01', songs: [{ name: 'A', count: 1 }] },
      { date: '2026-07-10', songs: [{ name: 'B', count: 1 }] },
      { date: '2026-07-15', songs: [{ name: 'A', count: 1 }] },
    ];
    expect(pastSongNames(sessions)).toEqual(['A', 'B']);
  });

  it('重複曲名は1件にまとめる', () => {
    const sessions = [{ date: '2026-07-10', songs: [{ name: 'A', count: 1 }, { name: 'A', count: 1 }] }];
    expect(pastSongNames(sessions)).toEqual(['A']);
  });

  it('count<=0 の曲は数えない（combineSongs / songTotals と揃える・#326）', () => {
    const sessions = [{ date: '2026-07-10', songs: [{ name: 'ゆき', count: 0 }, { name: 'A', count: 2 }] }];
    expect(pastSongNames(sessions)).toEqual(['A']);   // 旧実装は count:0 を 1 に持ち上げて 'ゆき' も出していた
  });

  it('limit 件で打ち切る（新しい順に）', () => {
    const sessions = [
      { date: '2026-07-12', songs: [{ name: 'A', count: 1 }] },
      { date: '2026-07-11', songs: [{ name: 'B', count: 1 }] },
      { date: '2026-07-10', songs: [{ name: 'C', count: 1 }] },
    ];
    expect(pastSongNames(sessions, 2)).toEqual(['A', 'B']);
  });

  it('セッションなしは空配列', () => {
    expect(pastSongNames([])).toEqual([]);
    expect(pastSongNames(undefined)).toEqual([]);
  });

  it('limit=Infinity で全曲を返す（datalist補完用）', () => {
    // 12曲を別々の日に弾く。曲0 が最新日なので先頭。
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-07-${String(12 - i).padStart(2, '0')}`,
      songs: [{ name: `曲${i}`, count: 1 }],
    }));
    const all = pastSongNames(sessions, Infinity);
    expect(all).toHaveLength(12);
    expect(all[0]).toBe('曲0'); // 最終練習日が最新の曲が先頭
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

  it('同数の tie は最終練習日が新しい順、並びを変えても一致する（#326）', () => {
    const sessions = [
      { date: '2026-07-10', songs: [{ name: 'A', count: 3 }] },
      { date: '2026-07-12', songs: [{ name: 'B', count: 3 }] },
    ];
    const asc = songTotals(sessions).map((t) => t.name);
    const desc = songTotals([...sessions].reverse()).map((t) => t.name);
    expect(asc).toEqual(['B', 'A']);   // B の方が最終練習日が新しい
    expect(desc).toEqual(asc);          // sessions の並びを変えても結果は同じ（旧実装は配列位置依存で入れ替わる）
  });

  it('最終練習日も同じ tie は曲名のコードポイント昇順で決定的（#326）', () => {
    const sessions = [
      { date: '2026-07-10', songs: [{ name: 'ちょうちょ', count: 3 }] },
      { date: '2026-07-10', songs: [{ name: 'きらきら', count: 3 }] },
    ];
    const a = songTotals(sessions).map((t) => t.name);
    expect(songTotals([...sessions].reverse()).map((t) => t.name)).toEqual(a);
    expect(a).toEqual(['きらきら', 'ちょうちょ']);   // き(U+304D) < ち(U+3061)
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

describe('normalizePraise', () => {
  it('有効な praise id はそのまま返す（#145）', () => {
    for (const p of PRAISE_STAMPS) {
      expect(normalizePraise(p.id)).toBe(p.id);
    }
  });

  it('未設定・無効値は null', () => {
    expect(normalizePraise(undefined)).toBeNull();
    expect(normalizePraise(null)).toBeNull();
    expect(normalizePraise('')).toBeNull();
    expect(normalizePraise('unknown')).toBeNull();
  });
});

describe('normalizeTempo', () => {
  it('有効な tempo id はそのまま返す（#239）', () => {
    for (const t of TEMPO_STAMPS) {
      expect(normalizeTempo(t.id)).toBe(t.id);
    }
  });

  it('3種（🐢ゆっくり/🎵ふつう/🚀はやく）を持つ', () => {
    expect(TEMPO_STAMPS.map((t) => t.id)).toEqual(['slow', 'normal', 'fast']);
  });

  it('未設定・無効値は null', () => {
    expect(normalizeTempo(undefined)).toBeNull();
    expect(normalizeTempo(null)).toBeNull();
    expect(normalizeTempo('')).toBeNull();
    expect(normalizeTempo('unknown')).toBeNull();
  });
});

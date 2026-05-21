import { describe, it, expect } from 'vitest';
import { collectSongs, isValidSession } from '../js/record-form.js';

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

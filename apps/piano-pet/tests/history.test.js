import { describe, it, expect } from 'vitest';
import {
  weekStart,
  sortByDateDesc,
  weeklyTotals,
  weeklyChartModel,
  weeklySummary,
  reviewShareText,
  weekLabel,
  formatDateJa,
} from '../js/history.js';

describe('weekStart', () => {
  it('月曜はその日自身を返す', () => {
    expect(weekStart('2026-05-18')).toBe('2026-05-18'); // 月曜
  });

  it('週の途中の日は直前の月曜を返す', () => {
    expect(weekStart('2026-05-22')).toBe('2026-05-18'); // 金曜
  });

  it('日曜は前の月曜を返す', () => {
    expect(weekStart('2026-05-24')).toBe('2026-05-18'); // 日曜
  });
});

describe('sortByDateDesc', () => {
  it('日付の新しい順に並べる', () => {
    const sorted = sortByDateDesc([
      { date: '2026-05-10' },
      { date: '2026-05-20' },
      { date: '2026-05-15' },
    ]);
    expect(sorted.map((s) => s.date)).toEqual(['2026-05-20', '2026-05-15', '2026-05-10']);
  });

  it('同日内は元の順序を保つ', () => {
    const sorted = sortByDateDesc([
      { date: '2026-05-20', id: 'a' },
      { date: '2026-05-20', id: 'b' },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('元の配列を破壊しない', () => {
    const input = [{ date: '2026-05-10' }, { date: '2026-05-20' }];
    sortByDateDesc(input);
    expect(input.map((s) => s.date)).toEqual(['2026-05-10', '2026-05-20']);
  });
});

describe('weeklyTotals', () => {
  it('指定週数ぶんを古い順に返す', () => {
    const result = weeklyTotals([], { weeks: 4, today: '2026-05-22' });
    expect(result.map((w) => w.weekStart)).toEqual([
      '2026-04-27',
      '2026-05-04',
      '2026-05-11',
      '2026-05-18',
    ]);
    expect(result.every((w) => w.total === 0)).toBe(true);
  });

  it('同じ週の記録を合算する', () => {
    const result = weeklyTotals(
      [
        { date: '2026-05-18', totalCount: 10 },
        { date: '2026-05-22', totalCount: 5 },
      ],
      { weeks: 4, today: '2026-05-22' },
    );
    const lastWeek = result.find((w) => w.weekStart === '2026-05-18');
    expect(lastWeek.total).toBe(15);
  });

  it('範囲外の古い記録は無視する', () => {
    const result = weeklyTotals(
      [{ date: '2026-01-01', totalCount: 99 }],
      { weeks: 4, today: '2026-05-22' },
    );
    expect(result.reduce((s, w) => s + w.total, 0)).toBe(0);
  });
});

describe('weeklyChartModel', () => {
  it('最大値を基準に比率を付与する', () => {
    const model = weeklyChartModel([
      { weekStart: '2026-05-04', total: 5 },
      { weekStart: '2026-05-11', total: 10 },
    ]);
    expect(model[0].ratio).toBe(0.5);
    expect(model[1].ratio).toBe(1);
  });

  it('全て0でもゼロ除算しない', () => {
    const model = weeklyChartModel([{ weekStart: '2026-05-04', total: 0 }]);
    expect(model[0].ratio).toBe(0);
  });
});

describe('weekLabel', () => {
  it('先頭ゼロを落とした M/D を返す', () => {
    expect(weekLabel('2026-05-04')).toBe('5/4');
  });
});

describe('formatDateJa', () => {
  it('M月D日（曜）形式を返す', () => {
    expect(formatDateJa('2026-05-22')).toBe('5月22日（金）');
    expect(formatDateJa('2026-05-18')).toBe('5月18日（月）');
  });
});

describe('weeklySummary', () => {
  const today = '2026-05-22'; // 金曜（週開始 月曜 2026-05-18）
  const sessions = [
    { date: '2026-05-18', totalCount: 5, songs: [{ name: 'きらきら', count: 3 }, { name: 'ちょうちょ', count: 2 }] },
    { date: '2026-05-20', totalCount: 4, songs: [{ name: 'きらきら', count: 4 }] },
    { date: '2026-05-11', totalCount: 9, songs: [{ name: 'ぶんぶん', count: 9 }] }, // 先週分は除外
  ];

  it('今週の回数・きょく数・日数を集計する', () => {
    const s = weeklySummary(sessions, today);
    expect(s.count).toBe(9);      // 5 + 4
    expect(s.songCount).toBe(2);  // きらきら / ちょうちょ（重複は1つ）
    expect(s.dayCount).toBe(2);   // 2日
  });

  it('先週以前の記録は含めない', () => {
    expect(weeklySummary(sessions, today).count).toBe(9);
  });

  it('count<=0 の曲は数えない', () => {
    const s = weeklySummary([{ date: today, totalCount: 0, songs: [{ name: 'x', count: 0 }] }], today);
    expect(s.songCount).toBe(0);
  });

  it('記録なしでもゼロを返す', () => {
    expect(weeklySummary([], today)).toMatchObject({ count: 0, songCount: 0, dayCount: 0 });
  });
});

describe('reviewShareText', () => {
  it('回数・きょく数・日数を含む本文を作る', () => {
    const text = reviewShareText({ petName: 'みけ', count: 9, songCount: 2, dayCount: 2, streak: 3 });
    expect(text).toContain('みけ');
    expect(text).toContain('9かい');
    expect(text).toContain('2きょく');
    expect(text).toContain('れんぞく 3日');
  });

  it('streak が 0 のときは連続行を出さない', () => {
    const text = reviewShareText({ petName: 'みけ', count: 1, songCount: 1, dayCount: 1, streak: 0 });
    expect(text).not.toContain('れんぞく');
  });

  it('名前が空でも既定名で作る', () => {
    expect(reviewShareText({ count: 0, songCount: 0, dayCount: 0, streak: 0 })).toContain('ねこ');
  });
});

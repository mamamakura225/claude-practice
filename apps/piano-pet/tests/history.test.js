import { describe, it, expect } from 'vitest';
import {
  weekStart,
  sortByDateDesc,
  weeklyTotals,
  weeklyChartModel,
  weekLabel,
  formatDateJa,
  PRAISE_OPTIONS,
  praiseById,
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

describe('praiseById（はなまるスタンプ #145）', () => {
  it('固定の3種（はなまる/じょうず/がんばった）を持つ', () => {
    expect(PRAISE_OPTIONS.map((p) => p.id)).toEqual(['hanamaru', 'jouzu', 'ganbatta']);
    expect(PRAISE_OPTIONS.every((p) => p.emoji && p.label)).toBe(true);
  });

  it('id から選択肢を引ける', () => {
    expect(praiseById('hanamaru')).toMatchObject({ emoji: '💮', label: 'はなまる' });
  });

  it('未設定・不正値は null', () => {
    expect(praiseById(undefined)).toBeNull();
    expect(praiseById('nope')).toBeNull();
  });
});

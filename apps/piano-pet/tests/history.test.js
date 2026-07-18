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
  dailyCountMap,
  heatLevel,
  shiftMonth,
  monthLabel,
  monthGrid,
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

describe('練習カレンダー（#236）', () => {
  it('dailyCountMap は同日を合算する', () => {
    const m = dailyCountMap([
      { date: '2026-05-01', totalCount: 3 },
      { date: '2026-05-01', totalCount: 4 },
      { date: '2026-05-02', totalCount: 5 },
    ]);
    expect(m.get('2026-05-01')).toBe(7);
    expect(m.get('2026-05-02')).toBe(5);
  });

  it('heatLevel は 0/半分未満/半分以上/目標達成 の4段階（目標10）', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(4, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(9, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(3);
    expect(heatLevel(99, 10)).toBe(3);
  });

  it('heatLevel は可変目標に追従（#238連動）', () => {
    expect(heatLevel(5, 5)).toBe(3);   // 目標5なら5回で達成
    expect(heatLevel(2, 5)).toBe(1);
    expect(heatLevel(3, 5)).toBe(2);
    expect(heatLevel(10, 20)).toBe(2); // 目標20なら10回はまだ2
    expect(heatLevel(20, 20)).toBe(3);
  });

  it('shiftMonth は年跨ぎを正しく処理する', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });

  it('monthLabel は YYYY年M月', () => {
    expect(monthLabel(2026, 5)).toBe('2026年5月');
  });

  it('monthGrid は日曜起点で前後を null 埋めし、7列の週配列を返す', () => {
    // 2026-05-01 は金曜（日曜起点で先頭5マスが null）。5月は31日。
    const weeks = monthGrid(2026, 5, [{ date: '2026-05-01', totalCount: 10 }], { today: '2026-05-15', goal: 10 });
    for (const w of weeks) expect(w).toHaveLength(7);
    expect(weeks[0].slice(0, 5).every((c) => c === null)).toBe(true);
    const may1 = weeks[0][5];
    expect(may1.date).toBe('2026-05-01');
    expect(may1.day).toBe(1);
    expect(may1.level).toBe(3);        // 10回=達成
    // 全日数（31）ぶんのセルが存在する
    const dayCells = weeks.flat().filter((c) => c);
    expect(dayCells).toHaveLength(31);
  });

  it('monthGrid は今日/未来フラグを立てる', () => {
    const weeks = monthGrid(2026, 5, [], { today: '2026-05-15', goal: 10 });
    const cells = weeks.flat().filter((c) => c);
    expect(cells.find((c) => c.date === '2026-05-15').isToday).toBe(true);
    expect(cells.find((c) => c.date === '2026-05-20').isFuture).toBe(true);
    expect(cells.find((c) => c.date === '2026-05-10').isFuture).toBe(false);
  });
});

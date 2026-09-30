import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatDate, isOverdue, addDays, addMonths, nextRecurrenceDeadline, todayStr, daysBetween } from '../utils/date.js';
import { filterTasks } from '../utils/filter.js';

describe('formatDate', () => {
  it('YYYY-MM-DD を YYYY/M/D に変換する', () => {
    expect(formatDate('2025-01-05')).toBe('2025/01/05');
  });

  it('月・日の0埋めを保持する', () => {
    expect(formatDate('2025-12-31')).toBe('2025/12/31');
  });

  it('null/undefinedはnullを返す', () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate('')).toBeNull();
  });
});

describe('addDays', () => {
  it('7日後の日付を返す', () => {
    expect(addDays('2025-01-01', 7)).toBe('2025-01-08');
  });

  it('月をまたぐ場合も正しく計算する', () => {
    expect(addDays('2025-01-30', 3)).toBe('2025-02-02');
  });

  it('マイナスの日数で過去の日付を返す', () => {
    expect(addDays('2025-01-10', -3)).toBe('2025-01-07');
  });
});

describe('addMonths', () => {
  it('1ヶ月後の日付を返す', () => {
    expect(addMonths('2025-01-15', 1)).toBe('2025-02-15');
  });

  it('年をまたぐ場合も正しく計算する', () => {
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01');
  });
});

describe('isOverdue', () => {
  it('過去の日付はtrueを返す', () => {
    expect(isOverdue('2000-01-01')).toBe(true);
  });

  it('未来の日付はfalseを返す', () => {
    expect(isOverdue('2099-12-31')).toBe(false);
  });

  it('nullはfalseを返す', () => {
    expect(isOverdue(null)).toBe(false);
    expect(isOverdue('')).toBe(false);
  });
});

describe('nextRecurrenceDeadline', () => {
  it('daily: 1日後を返す', () => {
    expect(nextRecurrenceDeadline('2025-01-01', { type: 'daily' })).toBe('2025-01-02');
  });

  it('weekly: 7日後を返す', () => {
    expect(nextRecurrenceDeadline('2025-01-01', { type: 'weekly' })).toBe('2025-01-08');
  });

  it('monthly: 1ヶ月後を返す', () => {
    expect(nextRecurrenceDeadline('2025-01-01', { type: 'monthly' })).toBe('2025-02-01');
  });
});

/* ローカル日付の境界 (#350)。TZ を実行時に切替え、時刻を固定して検証する */
describe.each([
  // 日本時間 07:00 ＝ UTC では前日 22:00（旧実装は UTC 日付を「今日」にしていた）
  { tz: 'Asia/Tokyo',          now: '2026-09-30T07:00:00+09:00' },
  // 米西海岸 20:00 ＝ UTC では翌日 03:00（旧 isOverdue は当日締切を期限切れと誤判定）
  { tz: 'America/Los_Angeles', now: '2026-09-30T20:00:00-07:00' },
])('ローカル日付 ($tz)', ({ tz, now }) => {
  let prevTz;
  beforeEach(() => {
    prevTz = process.env.TZ;
    process.env.TZ = tz;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  });

  it('todayStr は端末ローカルの日付を返す', () => {
    expect(todayStr()).toBe('2026-09-30');
  });

  it('当日締切は期限切れではなく、前日締切は期限切れ', () => {
    expect(isOverdue('2026-09-30')).toBe(false);
    expect(isOverdue('2026-09-29')).toBe(true);
  });

  it('クイック追加「明日」はローカルの翌日', () => {
    expect(addDays(todayStr(), 1)).toBe('2026-10-01');
  });

  it('期限未設定の繰り返しはローカルの今日を基準にする', () => {
    expect(nextRecurrenceDeadline('', { type: 'daily' })).toBe('2026-10-01');
  });

  it('「今日」プリセットは今日締切を含み、昨日締切は期限切れとしてだけ含む', () => {
    const tasks = [
      { id: 'today', title: 't', deadline: '2026-09-30', status: 'todo' },
      { id: 'yday',  title: 'y', deadline: '2026-09-29', status: 'done' },
    ];
    expect(filterTasks(tasks, { preset: 'today' }, todayStr()).map(t => t.id)).toEqual(['today']);
  });
});

describe('daysBetween', () => {
  it('月をまたぐ日数差を返す', () => {
    expect(daysBetween('2026-09-30', '2026-10-03')).toBe(3);
  });
});

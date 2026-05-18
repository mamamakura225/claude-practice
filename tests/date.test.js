import { describe, it, expect } from 'vitest';
import { formatDate, isOverdue, addDays, addMonths, nextRecurrenceDeadline } from '../utils/date.js';

describe('formatDate', () => {
  it('YYYY-MM-DD を YYYY/M/D に変換する', () => {
    expect(formatDate('2025-01-05')).toBe('わざと間違った期待値');
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

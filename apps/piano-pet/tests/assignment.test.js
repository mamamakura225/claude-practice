import { describe, it, expect } from 'vitest';
import {
  hasAssignment,
  primaryItem,
  assignmentProgress,
  makeAssignment,
} from '../js/assignment.js';

const session = (date, songs) => ({
  date,
  songs,
  totalCount: songs.reduce((n, s) => n + s.count, 0),
});

describe('hasAssignment / primaryItem', () => {
  it('null・items空は宿題なし', () => {
    expect(hasAssignment(null)).toBe(false);
    expect(hasAssignment({ items: [] })).toBe(false);
    expect(primaryItem({ items: [] })).toBe(null);
  });

  it('items先頭を対象にする（MVPは単一曲）', () => {
    const a = { items: [{ name: 'きらきらぼし', target: 5 }, { name: 'ちょうちょ', target: 3 }] };
    expect(hasAssignment(a)).toBe(true);
    expect(primaryItem(a)).toEqual({ name: 'きらきらぼし', target: 5 });
  });
});

describe('makeAssignment', () => {
  it('曲名ありで items を作り setAt を入れる', () => {
    const now = new Date('2026-06-05T01:00:00Z');
    const a = makeAssignment({ name: ' きらきらぼし ', target: '8', period: 'week' }, now);
    expect(a.items).toEqual([{ name: 'きらきらぼし', target: 8 }]);
    expect(a.period).toBe('week');
    expect(a.setAt).toBe('2026-06-05T01:00:00.000Z');
  });

  it('曲名空はクリア用トゥームストーン（items:[]）', () => {
    const a = makeAssignment({ name: '   ', period: 'day' });
    expect(a.items).toEqual([]);
    expect(typeof a.setAt).toBe('string');
  });

  it('target 不正は 1 に丸める / period 既定は day', () => {
    const a = makeAssignment({ name: 'a', target: 0 });
    expect(a.items[0].target).toBe(1);
    expect(a.period).toBe('day');
  });
});

describe('assignmentProgress', () => {
  it('宿題なしは null', () => {
    expect(assignmentProgress([], null, '2026-06-05')).toBe(null);
  });

  it('period=day は当日の該当曲のみ集計', () => {
    const sessions = [
      session('2026-06-05', [{ name: 'きらきらぼし', count: 4 }, { name: 'ちょうちょ', count: 2 }]),
      session('2026-06-04', [{ name: 'きらきらぼし', count: 9 }]),   // 前日は無視
    ];
    const a = { items: [{ name: 'きらきらぼし', target: 5 }], period: 'day' };
    const p = assignmentProgress(sessions, a, '2026-06-05');
    expect(p.count).toBe(4);
    expect(p.remaining).toBe(1);
    expect(p.achieved).toBe(false);
    expect(p.ratio).toBeCloseTo(0.8);
  });

  it('period=day で目標到達すると achieved', () => {
    const sessions = [session('2026-06-05', [{ name: 'a', count: 5 }])];
    const a = { items: [{ name: 'a', target: 5 }], period: 'day' };
    expect(assignmentProgress(sessions, a, '2026-06-05').achieved).toBe(true);
  });

  it('period=week は今週（月曜始まり）の合計', () => {
    // 2026-06-05 は金曜。週初め月曜=2026-06-01。
    const sessions = [
      session('2026-06-01', [{ name: 'a', count: 3 }]),   // 月（今週）
      session('2026-06-05', [{ name: 'a', count: 4 }]),   // 金（今週）
      session('2026-05-31', [{ name: 'a', count: 9 }]),   // 日（先週・除外）
    ];
    const a = { items: [{ name: 'a', target: 6 }], period: 'week' };
    const p = assignmentProgress(sessions, a, '2026-06-05');
    expect(p.count).toBe(7);
    expect(p.achieved).toBe(true);
  });

  it('曲名前後の空白を無視して一致させる', () => {
    const sessions = [session('2026-06-05', [{ name: ' a ', count: 5 }])];
    const a = { items: [{ name: 'a', target: 5 }], period: 'day' };
    expect(assignmentProgress(sessions, a, '2026-06-05').count).toBe(5);
  });
});

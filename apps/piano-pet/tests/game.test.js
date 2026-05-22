import { describe, it, expect } from 'vitest';
import {
  calcLevel,
  xpProgress,
  catStage,
  updateStreak,
  calcRewards,
  applySession,
  dailyProgress,
} from '../js/game.js';

function baseState(overrides = {}) {
  return {
    pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [] },
    inventory: [],
    streak: { current: 0, best: 0, lastPracticeDate: null },
    badges: [],
    sessions: [],
    ...overrides,
  };
}

describe('calcLevel / xpProgress', () => {
  it('XP閾値に応じてレベルが上がる', () => {
    expect(calcLevel(0)).toBe(1);
    expect(calcLevel(19)).toBe(1);
    expect(calcLevel(20)).toBe(2);
    expect(calcLevel(50)).toBe(3);
    expect(calcLevel(140)).toBe(5);
  });

  it('レベル6以降は+60ずつ', () => {
    expect(calcLevel(200)).toBe(6);
    expect(calcLevel(260)).toBe(7);
  });

  it('現レベル内の進捗とレベルアップまでの残りを返す', () => {
    const p = xpProgress(30); // レベル2 (20-50)
    expect(p.level).toBe(2);
    expect(p.xpInLevel).toBe(10);
    expect(p.xpPerLevel).toBe(30);
    expect(p.toNextLevel).toBe(20);
  });
});

describe('dailyProgress', () => {
  const sessions = [
    { date: '2026-05-22', totalCount: 4 },
    { date: '2026-05-22', totalCount: 3 },
    { date: '2026-05-21', totalCount: 9 },
  ];

  it('その日の合計を集計し、残り回数を返す', () => {
    const p = dailyProgress(sessions, '2026-05-22');
    expect(p.count).toBe(7);
    expect(p.remaining).toBe(3);
    expect(p.achieved).toBe(false);
    expect(p.ratio).toBeCloseTo(0.7);
  });

  it('目標到達で achieved=true、残り0、ratioは1で頭打ち', () => {
    const p = dailyProgress([{ date: '2026-05-22', totalCount: 12 }], '2026-05-22');
    expect(p.count).toBe(12);
    expect(p.remaining).toBe(0);
    expect(p.achieved).toBe(true);
    expect(p.ratio).toBe(1);
  });

  it('記録のない日は0', () => {
    const p = dailyProgress(sessions, '2026-05-20');
    expect(p.count).toBe(0);
    expect(p.remaining).toBe(10);
    expect(p.achieved).toBe(false);
  });
});

describe('catStage', () => {
  it('レベルに応じた成長段階を返す', () => {
    expect(catStage(1)).toBe('kitten');
    expect(catStage(5)).toBe('kitten');
    expect(catStage(6)).toBe('young');
    expect(catStage(15)).toBe('young');
    expect(catStage(16)).toBe('adult');
  });
});

describe('calcRewards', () => {
  it('1回=1コイン1XP', () => {
    expect(calcRewards(3, 1)).toEqual({ coins: 3, xp: 3 });
  });

  it('10回以上で目標達成ボーナス(+5コイン +3XP)', () => {
    expect(calcRewards(10, 1)).toEqual({ coins: 15, xp: 13 });
  });

  it('ストリーク3日でちょうど+10コイン', () => {
    expect(calcRewards(5, 3)).toEqual({ coins: 15, xp: 5 });
  });

  it('ストリーク7日でちょうど+30コイン', () => {
    expect(calcRewards(5, 7)).toEqual({ coins: 35, xp: 5 });
  });
});

describe('updateStreak', () => {
  it('前日に練習していれば連続が伸びる', () => {
    const s = updateStreak({ current: 2, best: 2, lastPracticeDate: '2026-05-21' }, '2026-05-22');
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });

  it('間が空いたらリセットして1から', () => {
    const s = updateStreak({ current: 5, best: 5, lastPracticeDate: '2026-05-19' }, '2026-05-22');
    expect(s.current).toBe(1);
    expect(s.best).toBe(5);
  });

  it('同じ日の二重記録はストリークを変えない', () => {
    const s = updateStreak({ current: 3, best: 3, lastPracticeDate: '2026-05-22' }, '2026-05-22');
    expect(s.current).toBe(3);
  });
});

describe('applySession', () => {
  it('コイン・XPを加算し、セッションを先頭に積む', () => {
    const { state, rewards } = applySession(baseState(), {
      date: '2026-05-22',
      songs: [{ name: 'きらきら星', count: 5 }],
      totalCount: 5,
    });
    expect(rewards.coins).toBe(5);
    expect(rewards.xp).toBe(5);
    expect(state.pet.coins).toBe(5);
    expect(state.pet.xp).toBe(5);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      date: '2026-05-22',
      totalCount: 5,
      coinsEarned: 5,
      xpEarned: 5,
    });
  });

  it('XPがしきい値を超えるとレベルアップを報告する', () => {
    const start = baseState({ pet: { name: 'き', level: 1, xp: 18, coins: 0, equippedItems: [] } });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 5 }],
      totalCount: 5,
    });
    expect(state.pet.xp).toBe(23);
    expect(state.pet.level).toBe(2);
    expect(rewards.leveled).toBe(true);
    expect(rewards.newLevel).toBe(2);
  });

  it('初回記録で first_practice バッジが付く', () => {
    const { state } = applySession(baseState(), {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 1 }],
      totalCount: 1,
    });
    expect(state.badges).toContain('first_practice');
  });

  it('元のstateを変更しない（イミュータブル）', () => {
    const start = baseState();
    applySession(start, { date: '2026-05-22', songs: [{ name: 'A', count: 3 }], totalCount: 3 });
    expect(start.pet.coins).toBe(0);
    expect(start.sessions).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  calcLevel,
  xpProgress,
  catStage,
  updateStreak,
  calcRewards,
  applySession,
  recomputeState,
  MAX_FREEZES,
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

describe('updateStreak: お休み券による救済', () => {
  it('1日抜けてもお休み券があれば連続を維持し、券を1枚消費する', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-20', freezes: 1 },
      '2026-05-22', // 5-21 が抜け
    );
    expect(s.current).toBe(6);
    expect(s.freezes).toBe(0);
    expect(s.frozeDays).toBe(1);
  });

  it('券がなければ1日抜けでリセット', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-20', freezes: 0 },
      '2026-05-22',
    );
    expect(s.current).toBe(1);
    expect(s.frozeDays).toBe(0);
  });

  it('抜けた日数より券が少なければリセット（券は維持）', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-19', freezes: 1 },
      '2026-05-22', // 2日抜け
    );
    expect(s.current).toBe(1);
    expect(s.freezes).toBe(1);
  });

  it('2日抜けでも券が2枚あれば維持し、2枚消費', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-19', freezes: 2 },
      '2026-05-22',
    );
    expect(s.current).toBe(6);
    expect(s.freezes).toBe(0);
    expect(s.frozeDays).toBe(2);
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

  it('3日連続のマイルストーンでお休み券を1枚付与する', () => {
    const start = baseState({
      streak: { current: 2, best: 2, lastPracticeDate: '2026-05-21', freezes: 0 },
    });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 2 }],
      totalCount: 2,
    });
    expect(state.streak.current).toBe(3);
    expect(state.streak.freezes).toBe(1);
    expect(rewards.freezeGranted).toBe(1);
  });

  it('お休み券は上限を超えて付与されない', () => {
    const start = baseState({
      streak: { current: 2, best: 2, lastPracticeDate: '2026-05-21', freezes: MAX_FREEZES },
    });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 2 }],
      totalCount: 2,
    });
    expect(state.streak.freezes).toBe(MAX_FREEZES);
    expect(rewards.freezeGranted).toBe(0);
  });

  it('抜けた日を救済したら rewards.frozeDays に反映する', () => {
    const start = baseState({
      streak: { current: 5, best: 5, lastPracticeDate: '2026-05-20', freezes: 1 },
    });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 2 }],
      totalCount: 2,
    });
    expect(state.streak.current).toBe(6);
    expect(state.streak.freezes).toBe(0);
    expect(rewards.frozeDays).toBe(1);
  });
});

describe('recomputeState', () => {
  function buildHistory(dates, counts) {
    let s = baseState();
    dates.forEach((d, i) => {
      s = applySession(s, { date: d, songs: [{ name: 'A', count: counts[i] }], totalCount: counts[i] }).state;
    });
    return s;
  }

  it('逐次 applySession と同じ XP・コイン・レベル・ストリークを再現する', () => {
    const live = buildHistory(['2026-05-20', '2026-05-21', '2026-05-22'], [5, 5, 12]);
    const recomputed = recomputeState(live, 0);
    expect(recomputed.pet.xp).toBe(live.pet.xp);
    expect(recomputed.pet.coins).toBe(live.pet.coins);
    expect(recomputed.pet.level).toBe(live.pet.level);
    expect(recomputed.streak.current).toBe(live.streak.current);
    expect(recomputed.streak.freezes).toBe(live.streak.freezes);
  });

  it('セッションを削除すると XP・コイン・ストリークが再計算される', () => {
    const live = buildHistory(['2026-05-21', '2026-05-22'], [5, 5]);
    const sessions = live.sessions.filter((s) => s.date !== '2026-05-22');
    const after = recomputeState({ ...live, sessions }, 0);
    expect(after.sessions).toHaveLength(1);
    expect(after.pet.xp).toBe(5);
    expect(after.pet.coins).toBe(5);
    expect(after.streak.current).toBe(1);
  });

  it('購入に使ったコイン(spent)を差し引き、マイナスにはしない', () => {
    const live = buildHistory(['2026-05-22'], [12]); // 獲得 17 コイン
    expect(recomputeState(live, 10).pet.coins).toBe(7);
    expect(recomputeState(live, 50).pet.coins).toBe(0);
  });

  it('資格を失ったバッジは剥がれる', () => {
    const live = buildHistory(['2026-05-22'], [3]);
    expect(live.badges).toContain('first_practice');
    const after = recomputeState({ ...live, sessions: [] }, 0);
    expect(after.badges).not.toContain('first_practice');
  });
});

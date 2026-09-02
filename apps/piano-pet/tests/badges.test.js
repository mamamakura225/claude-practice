import { describe, it, expect } from 'vitest';
import {
  BADGES,
  badgeById,
  isEarned,
  badgesWithStatus,
  earnedCount,
  newlyEarned,
} from '../js/badges.js';
import { checkBadges } from '../js/game.js';

describe('カタログ', () => {
  it('13種類のバッジを持ち id が checkBadges と一致する', () => {
    expect(BADGES).toHaveLength(13);
    const ids = BADGES.map((b) => b.id).sort();
    expect(ids).toEqual([
      'big_day', 'challenge_100', 'challenge_1000', 'challenge_500', 'days_100',
      'first_practice', 'month_30', 'songs_10', 'songs_5', 'streak_14',
      'streak_3', 'streak_30', 'streak_7',
    ]);
  });

  it('id が重複しない', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });

  it('badgeById は未知IDで null', () => {
    expect(badgeById('first_practice').icon).toBeTruthy();
    expect(badgeById('nope')).toBeNull();
  });
});

describe('isEarned / earnedCount', () => {
  it('state.badges を参照する', () => {
    const state = { badges: ['first_practice', 'streak_3'] };
    expect(isEarned(state, 'first_practice')).toBe(true);
    expect(isEarned(state, 'month_30')).toBe(false);
    expect(earnedCount(state)).toBe(2);
  });

  it('badges 未定義でも落ちない', () => {
    expect(isEarned({}, 'first_practice')).toBe(false);
    expect(earnedCount({})).toBe(0);
  });
});

describe('badgesWithStatus', () => {
  it('カタログ順で earned フラグを付ける', () => {
    const result = badgesWithStatus({ badges: ['streak_3'] });
    expect(result).toHaveLength(BADGES.length);
    expect(result.map((b) => b.id)).toEqual(BADGES.map((b) => b.id));
    expect(result.find((b) => b.id === 'streak_3').earned).toBe(true);
    expect(result.find((b) => b.id === 'first_practice').earned).toBe(false);
  });
});

describe('newlyEarned', () => {
  it('新たに増えたバッジのメタを返す', () => {
    const gained = newlyEarned(['first_practice'], ['first_practice', 'streak_3']);
    expect(gained.map((b) => b.id)).toEqual(['streak_3']);
  });

  it('変化なしなら空', () => {
    expect(newlyEarned(['first_practice'], ['first_practice'])).toEqual([]);
  });

  it('カタログに無いidは無視する', () => {
    expect(newlyEarned([], ['unknown_badge'])).toEqual([]);
  });
});

describe('checkBadges との結合', () => {
  it('初回記録で first_practice が取れ、カタログで表示できる', () => {
    const base = { badges: [], sessions: [{ date: '2026-05-01', totalCount: 5 }], streak: { current: 1, best: 1 } };
    const earned = checkBadges(base);
    expect(earned).toContain('first_practice');
    // 取得idがすべてカタログに存在する
    for (const id of earned) expect(badgeById(id)).not.toBeNull();
  });
});

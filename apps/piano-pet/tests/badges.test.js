import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  BADGES,
  badgeById,
  isEarned,
  badgesWithStatus,
  earnedCount,
  newlyEarned,
} from '../js/badges.js';

describe('カタログ', () => {
  // ソースを走査して突き合わせる。カタログを正にすると、判定だけ足して載せ忘れた
  // （取れたのに一覧に出ない）事故が見えない。
  it('判定（earned.add）とカタログの id が過不足なく一致する', () => {
    const dir = new URL('../js/', import.meta.url);
    const granted = readdirSync(dir).filter((f) => f.endsWith('.js'))
      .flatMap((f) => [...readFileSync(new URL(f, dir), 'utf8').matchAll(/earned\.add\('([^']+)'\)/g)].map((m) => m[1]));
    expect(granted.length).toBeGreaterThan(0);
    expect([...new Set(granted)].sort()).toEqual(BADGES.map((b) => b.id).sort());
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


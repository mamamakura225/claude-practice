import { describe, it, expect } from 'vitest';
import {
  FOODS,
  foodById,
  foodSpent,
  affinity,
  canFeed,
  feedCat,
} from '../js/feed.js';

function makeState(overrides = {}) {
  return {
    pet: {
      name: 'きーちゃん', level: 1, xp: 0, coins: 100,
      equippedItems: [], affinity: 0, foodSpent: 0,
      ...(overrides.pet ?? {}),
    },
    inventory: overrides.inventory ?? [],
  };
}

describe('カタログ', () => {
  it('えさが定義されている', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(3);
  });

  it('全えさが price・affinity・icon を持つ', () => {
    for (const f of FOODS) {
      expect(typeof f.price).toBe('number');
      expect(typeof f.affinity).toBe('number');
      expect(f.icon).toBeTruthy();
    }
  });

  it('foodById で取得・未知IDは null', () => {
    expect(foodById('fish').price).toBe(10);
    expect(foodById('unknown')).toBeNull();
  });
});

describe('canFeed', () => {
  it('コインが足りれば あげられる', () => {
    expect(canFeed(makeState({ pet: { coins: 10 } }), 'fish')).toBe(true);
  });

  it('コイン不足なら あげられない', () => {
    expect(canFeed(makeState({ pet: { coins: 9 } }), 'fish')).toBe(false);
  });

  it('未知のえさは あげられない', () => {
    expect(canFeed(makeState({ pet: { coins: 9999 } }), 'unknown')).toBe(false);
  });
});

describe('feedCat', () => {
  it('コインを引き なかよし度と消費総額を加算する', () => {
    const next = feedCat(makeState({ pet: { coins: 100 } }), 'treat');
    expect(next.pet.coins).toBe(70);          // 100 - 30
    expect(next.pet.affinity).toBe(3);        // treat は +3
    expect(next.pet.foodSpent).toBe(30);
  });

  it('連続であげると なかよし度・消費が積み上がる', () => {
    let s = makeState({ pet: { coins: 100 } });
    s = feedCat(s, 'fish');   // -10, +1, spent 10
    s = feedCat(s, 'milk');   // -15, +1, spent 25
    expect(s.pet.coins).toBe(75);
    expect(s.pet.affinity).toBe(2);
    expect(s.pet.foodSpent).toBe(25);
  });

  it('コイン不足なら state を変えない', () => {
    const state = makeState({ pet: { coins: 5 } });
    expect(feedCat(state, 'fish')).toBe(state);
  });

  it('元の state を破壊しない', () => {
    const state = makeState({ pet: { coins: 100 } });
    feedCat(state, 'fish');
    expect(state.pet.coins).toBe(100);
    expect(state.pet.affinity).toBe(0);
    expect(state.pet.foodSpent).toBe(0);
  });
});

describe('foodSpent / affinity アクセサ', () => {
  it('未定義なら 0 を返す', () => {
    expect(foodSpent({ pet: {} })).toBe(0);
    expect(affinity({ pet: {} })).toBe(0);
  });

  it('値があればそれを返す', () => {
    expect(foodSpent(makeState({ pet: { foodSpent: 40 } }))).toBe(40);
    expect(affinity(makeState({ pet: { affinity: 7 } }))).toBe(7);
  });
});

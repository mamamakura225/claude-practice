import { describe, it, expect } from 'vitest';
import {
  FOODS,
  foodById,
  foodSpent,
  affinity,
  canFeed,
  feedCat,
  AFFINITY_LEVELS,
  affinityLevel,
  affinityRewards,
  bondCelebrateChance,
  recordClipChance,
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
    expect(foodById('fish').price).toBe(5);
    expect(foodById('unknown')).toBeNull();
  });
});

describe('canFeed', () => {
  it('コインが足りれば あげられる', () => {
    expect(canFeed(makeState({ pet: { coins: 5 } }), 'fish')).toBe(true);
  });

  it('コイン不足なら あげられない', () => {
    expect(canFeed(makeState({ pet: { coins: 4 } }), 'fish')).toBe(false);
  });

  it('未知のえさは あげられない', () => {
    expect(canFeed(makeState({ pet: { coins: 9999 } }), 'unknown')).toBe(false);
  });
});

describe('feedCat', () => {
  it('コインを引き なかよし度と消費総額を加算する', () => {
    const next = feedCat(makeState({ pet: { coins: 100 } }), 'treat');
    expect(next.pet.coins).toBe(85);          // 100 - 15
    expect(next.pet.affinity).toBe(3);        // treat は +3
    expect(next.pet.foodSpent).toBe(15);
  });

  it('連続であげると なかよし度・消費が積み上がる', () => {
    let s = makeState({ pet: { coins: 100 } });
    s = feedCat(s, 'fish');   // -5, +1, spent 5
    s = feedCat(s, 'milk');   // -7, +1, spent 12
    expect(s.pet.coins).toBe(88);
    expect(s.pet.affinity).toBe(2);
    expect(s.pet.foodSpent).toBe(12);
  });

  it('コイン不足なら state を変えない', () => {
    const state = makeState({ pet: { coins: 4 } });
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

describe('affinityLevel', () => {
  it('しきい値ごとにレベルが上がる（#216 8段階）', () => {
    expect(affinityLevel(0).level).toBe(1);
    expect(affinityLevel(2).level).toBe(1);
    expect(affinityLevel(3).level).toBe(2);
    expect(affinityLevel(7).level).toBe(3);
    expect(affinityLevel(12).level).toBe(4);
    expect(affinityLevel(18).level).toBe(5);
    expect(affinityLevel(25).level).toBe(6);
    expect(affinityLevel(33).level).toBe(7);
    expect(affinityLevel(42).level).toBe(8);
    expect(affinityLevel(999).level).toBe(8);
  });

  it('次レベルまでの残り（toNext）と名前を返す', () => {
    const a = affinityLevel(1);
    expect(a.name).toBe('ともだち');
    expect(a.next.level).toBe(2);
    expect(a.toNext).toBe(2);        // 3 - 1
    expect(a.isMax).toBe(false);
  });

  it('進捗 ratio は 0〜1（レベル内の割合）', () => {
    expect(affinityLevel(3).ratio).toBe(0);   // Lv2 入りたて
    expect(affinityLevel(5).ratio).toBe(0.5); // 3→7 の中間
    expect(affinityLevel(7).ratio).toBe(0);   // Lv3 入りたて
  });

  it('最大レベルは isMax・toNext=0・ratio=1', () => {
    const a = affinityLevel(60);
    expect(a.isMax).toBe(true);
    expect(a.next).toBeNull();
    expect(a.toNext).toBe(0);
    expect(a.ratio).toBe(1);
  });

  it('負値・非数は 0 扱い', () => {
    expect(affinityLevel(-10).level).toBe(1);
    expect(affinityLevel(undefined).level).toBe(1);
    expect(affinityLevel(NaN).level).toBe(1);
  });
});

describe('affinityRewards', () => {
  it('現レベル以下のご褒美が解放済みになる', () => {
    const rewards = affinityRewards(12); // Lv4
    expect(rewards).toHaveLength(AFFINITY_LEVELS.length);
    expect(rewards.filter((r) => r.unlocked).map((r) => r.level)).toEqual([1, 2, 3, 4]);
    expect(rewards.find((r) => r.level === 5).unlocked).toBe(false);
  });

  it('affinity 0 でも Lv1 は解放済み', () => {
    expect(affinityRewards(0).find((r) => r.level === 1).unlocked).toBe(true);
  });
});

describe('bondCelebrateChance', () => {
  it('Lv4未満は0（専用演出は出ない）', () => {
    expect(bondCelebrateChance(1)).toBe(0);
    expect(bondCelebrateChance(3)).toBe(0);
  });

  it('レベルが上がるほど確率が高くなる', () => {
    expect(bondCelebrateChance(4)).toBeGreaterThan(0);
    expect(bondCelebrateChance(5)).toBeGreaterThan(bondCelebrateChance(4));
    expect(bondCelebrateChance(6)).toBeGreaterThan(bondCelebrateChance(5));
    expect(bondCelebrateChance(7)).toBeGreaterThan(bondCelebrateChance(6));
    expect(bondCelebrateChance(8)).toBeGreaterThan(bondCelebrateChance(7));
  });
});

describe('recordClipChance（#227）', () => {
  it('Lv1 から 0 より大きい（始めたばかりの子も見られる）', () => {
    expect(recordClipChance(1)).toBeGreaterThan(0);
  });

  it('レベルが上がると単調に増える（減らない）', () => {
    const levels = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 1; i < levels.length; i += 1) {
      expect(recordClipChance(levels[i])).toBeGreaterThanOrEqual(recordClipChance(levels[i - 1]));
    }
  });

  it('しきい値の境界（4 / 6 / 8 で上がる・#296 で引き上げ）', () => {
    expect(recordClipChance(3)).toBe(0.25);
    expect(recordClipChance(4)).toBe(0.40);
    expect(recordClipChance(5)).toBe(0.40);
    expect(recordClipChance(6)).toBe(0.55);
    expect(recordClipChance(7)).toBe(0.55);
    expect(recordClipChance(8)).toBe(0.70);
  });

  it('確率なので 0〜1 の範囲に収まる', () => {
    for (let lv = 0; lv <= 10; lv += 1) {
      const p = recordClipChance(lv);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

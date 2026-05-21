import { describe, it, expect } from 'vitest';
import {
  SHOP_ITEMS,
  itemById,
  isOwned,
  isEquipped,
  canBuy,
  buyItem,
  equipItem,
  unequipItem,
  toggleEquip,
} from '../js/shop.js';

function makeState(overrides = {}) {
  return {
    pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 100, equippedItems: [], ...(overrides.pet ?? {}) },
    inventory: overrides.inventory ?? [],
  };
}

describe('カタログ', () => {
  it('5種類のアイテムを持つ', () => {
    expect(SHOP_ITEMS).toHaveLength(5);
  });

  it('itemById で取得・未知IDは null', () => {
    expect(itemById('ribbon').price).toBe(50);
    expect(itemById('unknown')).toBeNull();
  });
});

describe('canBuy', () => {
  it('コインが足りて未所持なら買える', () => {
    expect(canBuy(makeState({ pet: { coins: 50 } }), 'ribbon')).toBe(true);
  });

  it('コイン不足なら買えない', () => {
    expect(canBuy(makeState({ pet: { coins: 49 } }), 'ribbon')).toBe(false);
  });

  it('所持済みは買えない', () => {
    expect(canBuy(makeState({ pet: { coins: 100 }, inventory: ['ribbon'] }), 'ribbon')).toBe(false);
  });

  it('未知IDは買えない', () => {
    expect(canBuy(makeState({ pet: { coins: 9999 } }), 'unknown')).toBe(false);
  });
});

describe('buyItem', () => {
  it('コインを引いてインベントリに追加する', () => {
    const next = buyItem(makeState({ pet: { coins: 100 } }), 'hat');
    expect(next.pet.coins).toBe(20);
    expect(next.inventory).toEqual(['hat']);
  });

  it('買えない場合は state を変えない', () => {
    const state = makeState({ pet: { coins: 10 } });
    const next = buyItem(state, 'crown');
    expect(next).toBe(state);
  });

  it('元の state を破壊しない', () => {
    const state = makeState({ pet: { coins: 100 } });
    buyItem(state, 'ribbon');
    expect(state.pet.coins).toBe(100);
    expect(state.inventory).toEqual([]);
  });
});

describe('equipItem', () => {
  it('所持品を装備する', () => {
    const next = equipItem(makeState({ inventory: ['ribbon'] }), 'ribbon');
    expect(next.pet.equippedItems).toEqual(['ribbon']);
  });

  it('未所持は装備できない', () => {
    const state = makeState();
    expect(equipItem(state, 'ribbon')).toBe(state);
  });

  it('同じスロットの既存装備を外してから付ける', () => {
    // ribbon と collar はどちらも neck
    const state = makeState({ inventory: ['ribbon', 'collar'], pet: { equippedItems: ['ribbon'] } });
    const next = equipItem(state, 'collar');
    expect(next.pet.equippedItems).toEqual(['collar']);
  });

  it('別スロットは共存できる', () => {
    const state = makeState({ inventory: ['ribbon', 'hat'], pet: { equippedItems: ['ribbon'] } });
    const next = equipItem(state, 'hat');
    expect(next.pet.equippedItems).toEqual(['ribbon', 'hat']);
  });
});

describe('unequipItem', () => {
  it('装備を外す', () => {
    const state = makeState({ inventory: ['ribbon'], pet: { equippedItems: ['ribbon'] } });
    expect(unequipItem(state, 'ribbon').pet.equippedItems).toEqual([]);
  });
});

describe('toggleEquip', () => {
  it('未装備なら装備、装備中なら外す', () => {
    const owned = makeState({ inventory: ['hat'] });
    const equipped = toggleEquip(owned, 'hat');
    expect(isEquipped(equipped, 'hat')).toBe(true);
    const removed = toggleEquip(equipped, 'hat');
    expect(isEquipped(removed, 'hat')).toBe(false);
  });

  it('未所持は無変更', () => {
    const state = makeState();
    expect(toggleEquip(state, 'hat')).toBe(state);
  });
});

describe('isOwned / isEquipped', () => {
  it('インベントリ・装備配列を参照する', () => {
    const state = makeState({ inventory: ['cape'], pet: { equippedItems: ['cape'] } });
    expect(isOwned(state, 'cape')).toBe(true);
    expect(isOwned(state, 'crown')).toBe(false);
    expect(isEquipped(state, 'cape')).toBe(true);
    expect(isEquipped(state, 'crown')).toBe(false);
  });
});

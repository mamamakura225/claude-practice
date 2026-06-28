import { describe, it, expect } from 'vitest';
import {
  SHOP_ITEMS,
  itemById,
  isOwned,
  isEquipped,
  canBuy,
  isUnlocked,
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
  it('10種類のアイテムを持つ', () => {
    expect(SHOP_ITEMS).toHaveLength(10);
  });

  it('itemById で取得・未知IDは null', () => {
    expect(itemById('ribbon').price).toBe(50);
    expect(itemById('glasses').slot).toBe('face');
    expect(itemById('unknown')).toBeNull();
  });

  it('全アイテムが price・slot・icon を持つ', () => {
    for (const item of SHOP_ITEMS) {
      expect(typeof item.price).toBe('number');
      expect(item.slot).toBeTruthy();
      expect(item.icon).toBeTruthy();
    }
  });

  // #191/#196: 絵文字一致と表示名の確定（id は据え置き＝保存データ後方互換）
  it('bowtie はループリボン・cape は 🧥（#191 個別決定）', () => {
    expect(itemById('bowtie').name).toBe('ループリボン');
    expect(itemById('cape').icon).toBe('🧥');
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

  // #126: なかよしLv未到達はコインが足りても買えない
  it('なかよしLv未解放はコインが足りても買えない', () => {
    // crown は unlockLevel 8（affinity 42・#216）。affinity 0 では Lv1 で未解放。
    expect(canBuy(makeState({ pet: { coins: 9999, affinity: 0 } }), 'crown')).toBe(false);
  });

  it('なかよしLv到達＋コインありで買える', () => {
    expect(canBuy(makeState({ pet: { coins: 9999, affinity: 42 } }), 'crown')).toBe(true);
  });
});

// #126: 解放ゲートは affinity から決定的に導出（専用フラグなし）。購入時のみ参照。
describe('isUnlocked（なかよしLv解放）', () => {
  it('Lv1 アイテムは affinity 0 でも解放', () => {
    expect(isUnlocked(makeState({ pet: { affinity: 0 } }), 'ribbon')).toBe(true);
  });

  it('しきい値ちょうどで解放（Lv4=affinity12・#216）', () => {
    expect(isUnlocked(makeState({ pet: { affinity: 11 } }), 'scarf')).toBe(false);
    expect(isUnlocked(makeState({ pet: { affinity: 12 } }), 'scarf')).toBe(true);
  });

  it('最上位 Lv8（affinity42・#216）', () => {
    expect(isUnlocked(makeState({ pet: { affinity: 41 } }), 'crown')).toBe(false);
    expect(isUnlocked(makeState({ pet: { affinity: 42 } }), 'crown')).toBe(true);
  });

  it('affinity 未設定は Lv1 扱い', () => {
    expect(isUnlocked(makeState(), 'hat')).toBe(true);      // Lv1
    expect(isUnlocked(makeState(), 'cape')).toBe(false);    // Lv6
  });
});

// #126 後方互換の鉄則：装備/所持判定は現在Lvを一切参照しない。
// affinity が下がって再ロック状態でも、所持済み・装備中のアイテムは保持される。
describe('解放ゲートと後方互換（affinity 低下時の所持品保持）', () => {
  it('affinity が下がっても所持品は保持・装備継続できる', () => {
    // crown(Lv8) を所持・装備中で affinity が 0 に低下した状態
    const state = makeState({ inventory: ['crown'], pet: { affinity: 0, equippedItems: ['crown'] } });
    expect(isUnlocked(state, 'crown')).toBe(false);   // 購入は再ロック
    expect(isOwned(state, 'crown')).toBe(true);       // 所持は保持
    expect(isEquipped(state, 'crown')).toBe(true);    // 装備も保持
    // 外して付け直しも Lv に関係なくできる
    const off = unequipItem(state, 'crown');
    expect(isEquipped(off, 'crown')).toBe(false);
    expect(equipItem(off, 'crown').pet.equippedItems).toEqual(['crown']);
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

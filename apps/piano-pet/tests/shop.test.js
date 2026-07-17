import { describe, it, expect } from 'vitest';
import {
  SHOP_ITEMS,
  itemById,
  isOwned,
  isEquipped,
  isPlaced,
  canBuy,
  isUnlocked,
  buyItem,
  equipItem,
  unequipItem,
  toggleEquip,
  placeItem,
  unplaceItem,
  togglePlace,
  spentCoins,
} from '../js/shop.js';

function makeState(overrides = {}) {
  return {
    pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 100, equippedItems: [], ...(overrides.pet ?? {}) },
    inventory: overrides.inventory ?? [],
  };
}

describe('カタログ', () => {
  it('16種類のアイテムを持つ', () => {
    expect(SHOP_ITEMS).toHaveLength(16);
  });

  // #210: 追加アイテムが各スロットに割り当てられている
  it('追加アイテム（#210）の slot が正しい', () => {
    expect(itemById('beret').slot).toBe('head');
    expect(itemById('sunglasses').slot).toBe('face');
    expect(itemById('bell').slot).toBe('neck');
    expect(itemById('wings').slot).toBe('back');
  });

  // #226: 置物・小物系は slot:'scene'
  it('置物アイテム（#226）の slot が scene', () => {
    expect(itemById('yarnBall').slot).toBe('scene');
    expect(itemById('cushion').slot).toBe('scene');
  });

  it('itemById で取得・未知IDは null', () => {
    expect(itemById('ribbon').price).toBe(25);
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
    expect(canBuy(makeState({ pet: { coins: 25 } }), 'ribbon')).toBe(true);
  });

  it('コイン不足なら買えない', () => {
    expect(canBuy(makeState({ pet: { coins: 24 } }), 'ribbon')).toBe(false);
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
    expect(next.pet.coins).toBe(60);
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

// #250: 値下げ時に既存ユーザーへ差額が自動返金される（recomputeState の spent が縮む）という
// 設計判断は、spentCoins が「支払額」ではなく「現行価格の合計」であることに乗っている。
describe('spentCoins', () => {
  it('インベントリを現行価格で合計する', () => {
    expect(spentCoins(makeState({ inventory: ['ribbon', 'hat'] }))).toBe(25 + 40);
  });

  it('未所持・未知IDは 0 として扱う', () => {
    expect(spentCoins(makeState())).toBe(0);
    expect(spentCoins(makeState({ inventory: ['unknown'] }))).toBe(0);
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

// 置物・小物系（シーン配置型・#226）。装備とは別配列 placedItems で排他なし管理。
describe('placeItem / unplaceItem / togglePlace（#226）', () => {
  it('所持品を配置できる（排他なし・装備配列は不変）', () => {
    const state = makeState({ inventory: ['cushion', 'yarnBall'], pet: { equippedItems: ['ribbon'] } });
    const a = placeItem(state, 'cushion');
    const b = placeItem(a, 'yarnBall');                       // 排他しないので両方残る
    expect([...b.pet.placedItems].sort()).toEqual(['cushion', 'yarnBall']);
    expect(b.pet.equippedItems).toEqual(['ribbon']);          // 装備は汚さない
  });

  it('未所持・配置済みは無変更', () => {
    const state = makeState({ inventory: ['cushion'], pet: { placedItems: ['cushion'] } });
    expect(placeItem(state, 'yarnBall')).toBe(state);         // 未所持
    expect(placeItem(state, 'cushion')).toBe(state);          // 既に配置済み（重複しない）
  });

  it('unplaceItem で配置を解除', () => {
    const state = makeState({ inventory: ['cushion'], pet: { placedItems: ['cushion'] } });
    expect(unplaceItem(state, 'cushion').pet.placedItems).toEqual([]);
  });

  it('togglePlace で配置のオンオフ、未所持は無変更', () => {
    const owned = makeState({ inventory: ['yarnBall'] });
    const placed = togglePlace(owned, 'yarnBall');
    expect(isPlaced(placed, 'yarnBall')).toBe(true);
    expect(isPlaced(togglePlace(placed, 'yarnBall'), 'yarnBall')).toBe(false);
    expect(togglePlace(owned, 'cushion')).toBe(owned);        // 未所持は無変更
  });
});

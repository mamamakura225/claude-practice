// ===== ショップの純粋ロジック =====
// アイテムIDと装備時の見た目は cat.js の ITEMS / ITEM_ANCHOR_TYPE に対応する。
// slot は装備スロット（同一スロットは1つだけ装備できる）。
export const SHOP_ITEMS = [
  { id: 'ribbon', name: '赤いリボン', price: 50, slot: 'neck', icon: '🎀' },
  { id: 'hat', name: '麦わら帽子', price: 80, slot: 'head', icon: '👒' },
  { id: 'collar', name: '星の首輪', price: 100, slot: 'neck', icon: '⭐' },
  { id: 'cape', name: 'ミニマント', price: 150, slot: 'back', icon: '🦸' },
  { id: 'crown', name: '王冠', price: 300, slot: 'head', icon: '👑' },
];

export function itemById(id) {
  return SHOP_ITEMS.find((it) => it.id === id) ?? null;
}

export function isOwned(state, id) {
  return (state.inventory ?? []).includes(id);
}

export function isEquipped(state, id) {
  return (state.pet?.equippedItems ?? []).includes(id);
}

// 購入可否：未所持・実在アイテム・コインが価格以上
export function canBuy(state, id) {
  const item = itemById(id);
  if (!item || isOwned(state, id)) return false;
  return (state.pet?.coins ?? 0) >= item.price;
}

// 購入：コインを引き、インベントリに追加した新 state を返す（不可なら無変更）
export function buyItem(state, id) {
  if (!canBuy(state, id)) return state;
  const item = itemById(id);
  return {
    ...state,
    pet: { ...state.pet, coins: state.pet.coins - item.price },
    inventory: [...(state.inventory ?? []), id],
  };
}

// 装備：所持品のみ。同一スロットの既存装備は外してから付ける。
export function equipItem(state, id) {
  if (!isOwned(state, id)) return state;
  const slot = itemById(id)?.slot;
  const kept = (state.pet.equippedItems ?? []).filter((eid) => itemById(eid)?.slot !== slot);
  return { ...state, pet: { ...state.pet, equippedItems: [...kept, id] } };
}

export function unequipItem(state, id) {
  return {
    ...state,
    pet: {
      ...state.pet,
      equippedItems: (state.pet.equippedItems ?? []).filter((eid) => eid !== id),
    },
  };
}

// 装備のトグル（所持していなければ無変更）
export function toggleEquip(state, id) {
  if (!isOwned(state, id)) return state;
  return isEquipped(state, id) ? unequipItem(state, id) : equipItem(state, id);
}

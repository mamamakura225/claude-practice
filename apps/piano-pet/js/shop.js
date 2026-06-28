// ===== ショップの純粋ロジック =====
// アイテムIDと装備時の見た目は cat.js の ITEMS / ITEM_ANCHOR_TYPE に対応する。
// slot は装備スロット（同一スロットは1つだけ装備できる）。
// unlockLevel は購入解放に必要な「なかよしレベル」(#126・価格帯で割当)。判定は購入時のみ
// （canBuy）に効き、装備・描画は所持/装備のみで判定＝affinity 低下でも所持品は保持される。
// #216 で 8段階化した際、旧 Lv2/3/4/5（affinity 5/15/30/50）と等価な affinity 値の新レベル
// 2/4/6/8 へ再マップ。既存ユーザーは同じ affinity で従来どおり購入できる（退行なし）。
import { affinityLevel } from './feed.js';

export const SHOP_ITEMS = [
  { id: 'ribbon', name: '赤いリボン', price: 50, slot: 'neck', icon: '🎀', unlockLevel: 1 },
  { id: 'bowtie', name: 'ループリボン', price: 70, slot: 'neck', icon: '🎗️', unlockLevel: 1 },
  { id: 'hat', name: '麦わら帽子', price: 80, slot: 'head', icon: '👒', unlockLevel: 1 },
  { id: 'flower', name: 'おはな', price: 90, slot: 'head', icon: '🌸', unlockLevel: 2 },
  { id: 'collar', name: '星の首輪', price: 100, slot: 'neck', icon: '⭐', unlockLevel: 2 },
  { id: 'scarf', name: 'マフラー', price: 120, slot: 'neck', icon: '🧣', unlockLevel: 4 },
  { id: 'glasses', name: 'めがね', price: 130, slot: 'face', icon: '👓', unlockLevel: 4 },
  { id: 'cape', name: 'ミニマント', price: 150, slot: 'back', icon: '🧥', unlockLevel: 6 },
  { id: 'flowerCrown', name: 'はなかんむり', price: 260, slot: 'head', icon: '💮', unlockLevel: 8 },
  { id: 'crown', name: '王冠', price: 300, slot: 'head', icon: '👑', unlockLevel: 8 },
];

export function itemById(id) {
  return SHOP_ITEMS.find((it) => it.id === id) ?? null;
}

export function isOwned(state, id) {
  return (state.inventory ?? []).includes(id);
}

// 所持アイテムの購入に使ったコイン総額
export function spentCoins(state) {
  return (state.inventory ?? []).reduce((sum, id) => sum + (itemById(id)?.price ?? 0), 0);
}

export function isEquipped(state, id) {
  return (state.pet?.equippedItems ?? []).includes(id);
}

// 解放可否（#126）：現在のなかよしレベルが unlockLevel 以上か。
// affinity から決定的に導出（専用フラグなし）。購入時のみ参照し装備/描画では使わない。
export function isUnlocked(state, id) {
  const item = itemById(id);
  if (!item) return false;
  return affinityLevel(state.pet?.affinity ?? 0).level >= (item.unlockLevel ?? 1);
}

// 購入可否：未所持・実在アイテム・なかよしLv解放済み・コインが価格以上
export function canBuy(state, id) {
  const item = itemById(id);
  if (!item || isOwned(state, id) || !isUnlocked(state, id)) return false;
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

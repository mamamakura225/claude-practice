// ===== ショップの純粋ロジック =====
// アイテムIDと装備時の見た目は cat.js の ITEMS / ITEM_ANCHOR_TYPE に対応する。
// slot は装備スロット（同一スロットは1つだけ装備できる）。
// unlockLevel は購入解放に必要な「なかよしレベル」(#126・価格帯で割当)。判定は購入時のみ
// （canBuy）に効き、装備・描画は所持/装備のみで判定＝affinity 低下でも所持品は保持される。
// #216 で 8段階化した際、旧 Lv2/3/4/5（affinity 5/15/30/50）と等価な affinity 値の新レベル
// 2/4/6/8 へ再マップ。既存ユーザーは同じ affinity で従来どおり購入できる（退行なし）。
import { affinityLevel } from './feed.js';

export const SHOP_ITEMS = [
  { id: 'ribbon', name: '赤いリボン', price: 25, slot: 'neck', icon: '🎀', unlockLevel: 1 },
  { id: 'bowtie', name: 'ループリボン', price: 35, slot: 'neck', icon: '🎗️', unlockLevel: 1 },
  { id: 'hat', name: '麦わら帽子', price: 40, slot: 'head', icon: '👒', unlockLevel: 1 },
  { id: 'flower', name: 'おはな', price: 45, slot: 'head', icon: '🌸', unlockLevel: 2 },
  { id: 'collar', name: '星の首輪', price: 50, slot: 'neck', icon: '⭐', unlockLevel: 2 },
  { id: 'beret', name: 'ベレーぼう', price: 55, slot: 'head', icon: '🎨', unlockLevel: 2 },
  { id: 'bell', name: 'すずのくびわ', price: 55, slot: 'neck', icon: '🔔', unlockLevel: 2 },
  { id: 'scarf', name: 'マフラー', price: 60, slot: 'neck', icon: '🧣', unlockLevel: 4 },
  { id: 'glasses', name: 'めがね', price: 65, slot: 'face', icon: '👓', unlockLevel: 4 },
  { id: 'sunglasses', name: 'サングラス', price: 70, slot: 'face', icon: '😎', unlockLevel: 4 },
  { id: 'cape', name: 'ミニマント', price: 75, slot: 'back', icon: '🧥', unlockLevel: 6 },
  { id: 'wings', name: 'てんしのはね', price: 110, slot: 'back', icon: '🪽', unlockLevel: 6 },
  { id: 'flowerCrown', name: 'はなかんむり', price: 130, slot: 'head', icon: '💮', unlockLevel: 8 },
  { id: 'crown', name: '王冠', price: 150, slot: 'head', icon: '👑', unlockLevel: 8 },
  // 置物・小物系（シーン配置型・#226）。slot:'scene' は排他なし複数配置で、装備とは別管理
  // （placedItems）。価格・解放Lvは既存帯に合わせる。描画枠・layer は cat-image.js の SCENE_BOX。
  { id: 'yarnBall', name: 'けいとだま', price: 40, slot: 'scene', icon: '🧶', unlockLevel: 1 },
  { id: 'cushion', name: 'クッション', price: 60, slot: 'scene', icon: '🛋️', unlockLevel: 2 },
];

export function itemById(id) {
  return SHOP_ITEMS.find((it) => it.id === id) ?? null;
}

export function isOwned(state, id) {
  return (state.inventory ?? []).includes(id);
}

// 所持アイテムの購入に使ったコイン総額。支払額ではなく現行価格で毎回導出するため、price を
// 変えると次の recomputeState で既存ユーザーへ差額が反映される（#250 の設計判断・features.md）。
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

// ----- 置物・小物系（シーン配置型・#226） -----
// 装備（slot排他あり・equippedItems）と分離し、排他なしで複数配置できる pet.placedItems を別管理する。
// equipItem/spentCoins/cleanItemLayout 等の装着ロジックには一切触れない。
export function isPlaced(state, id) {
  return (state.pet?.placedItems ?? []).includes(id);
}

// 配置：所持品のみ。排他しないので既存配置はそのまま追加する（重複は防ぐ）。
export function placeItem(state, id) {
  if (!isOwned(state, id) || isPlaced(state, id)) return state;
  return { ...state, pet: { ...state.pet, placedItems: [...(state.pet.placedItems ?? []), id] } };
}

export function unplaceItem(state, id) {
  return {
    ...state,
    pet: {
      ...state.pet,
      placedItems: (state.pet.placedItems ?? []).filter((pid) => pid !== id),
    },
  };
}

// 配置のトグル（所持していなければ無変更）
export function togglePlace(state, id) {
  if (!isOwned(state, id)) return state;
  return isPlaced(state, id) ? unplaceItem(state, id) : placeItem(state, id);
}

// ===== えさやりの純粋ロジック =====
// コインの使い道その2（ショップの装備に対し、こちらは消費型）。
// えさをあげると「なかよし度(affinity)」が増える。コインの消費総額は
// pet.foodSpent に積み上げ、記録の編集・削除時の全再計算（recomputeState）で
// 所持コインが復活しないようにする（装備の spentCoins と同じ役割）。
export const FOODS = [
  { id: 'fish',  name: 'おさかな', price: 10, icon: '🐟', affinity: 1 },
  { id: 'milk',  name: 'ミルク',   price: 15, icon: '🥛', affinity: 1 },
  { id: 'treat', name: 'ケーキ', price: 30, icon: '🍰', affinity: 3 },
];

export function foodById(id) {
  return FOODS.find((f) => f.id === id) ?? null;
}

// これまでにえさへ使ったコイン総額（recomputeState の spent 計算に合算する）
export function foodSpent(state) {
  return state.pet?.foodSpent ?? 0;
}

export function affinity(state) {
  return state.pet?.affinity ?? 0;
}

// えさやり可否：実在するえさで、コインが価格以上
export function canFeed(state, id) {
  const food = foodById(id);
  if (!food) return false;
  return (state.pet?.coins ?? 0) >= food.price;
}

// えさをあげる：コインを引き、なかよし度と消費総額を加算した新 state を返す（不可なら無変更）
export function feedCat(state, id) {
  if (!canFeed(state, id)) return state;
  const food = foodById(id);
  return {
    ...state,
    pet: {
      ...state.pet,
      coins: state.pet.coins - food.price,
      affinity: (state.pet.affinity ?? 0) + food.affinity,
      foodSpent: (state.pet.foodSpent ?? 0) + food.price,
    },
  };
}

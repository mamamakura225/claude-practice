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

// ===== なかよしレベルとご褒美（#124） =====
// affinity（なかよし度）のしきい値で「なかよしレベル」が上がり、ご褒美が解放される。
// 解放状態は affinity から決定的に導出する（専用フラグを持たない）。affinity は
// recomputeState が pet ごと保持するため、全再計算でも解放状態は矛盾しない。
export const AFFINITY_LEVELS = [
  { level: 1, name: 'ともだち',       min: 0,  reward: 'いっしょに あそぼう' },
  { level: 2, name: 'なかよし',       min: 5,  reward: 'ホームの ねこに ハートの しるしが つくよ' },
  { level: 3, name: 'だいすき',       min: 15, reward: 'なでると ときどき とくべつな えんしゅつ' },
  { level: 4, name: 'ベストフレンド', min: 30, reward: 'ハートが もっと キラキラ ひかるよ' },
  { level: 5, name: 'きずな',         min: 50, reward: 'さいこうの なかよし えんしゅつ' },
];

// affinity 値（数値）→ 現在のなかよしレベル情報＋次レベルへの進捗。
export function affinityLevel(value) {
  const v = Math.max(0, Number(value) || 0);
  let idx = 0;
  for (let i = 0; i < AFFINITY_LEVELS.length; i += 1) {
    if (v >= AFFINITY_LEVELS[i].min) idx = i;
  }
  const cur = AFFINITY_LEVELS[idx];
  const next = AFFINITY_LEVELS[idx + 1] ?? null;
  const span = next ? next.min - cur.min : 0;
  return {
    level: cur.level,
    name: cur.name,
    min: cur.min,
    value: v,
    next,
    isMax: !next,
    toNext: next ? next.min - v : 0,
    ratio: next ? (span > 0 ? Math.min(1, (v - cur.min) / span) : 1) : 1,
  };
}

// 全ご褒美に解放フラグ（unlocked）を付けて返す。ショップの解放リスト表示用。
export function affinityRewards(value) {
  const current = affinityLevel(value).level;
  return AFFINITY_LEVELS.map((l) => ({
    level: l.level,
    name: l.name,
    min: l.min,
    reward: l.reward,
    unlocked: current >= l.level,
  }));
}

// なでなで時に「とくべつな えんしゅつ」(playCelebrate) が出る確率。
// なかよしレベル3で解放、レベルが上がるほど出やすくなる（#124 専用演出）。
export function bondCelebrateChance(level) {
  if (level >= 5) return 0.5;
  if (level >= 4) return 0.35;
  if (level >= 3) return 0.2;
  return 0;
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

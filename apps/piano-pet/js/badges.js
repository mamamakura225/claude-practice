// ===== バッジ（実績）のカタログと純粋ヘルパー =====
// 取得判定そのものは game.js の checkBadges が担い、state.badges に id 配列で
// 保存される。ここではその id に表示用メタ（名前・説明・アイコン）を対応づけ、
// 一覧表示や新規取得の差分計算を行う。

// 表示順は易しい順（達成しやすいもの→難しいもの）
export const BADGES = [
  { id: 'first_practice', name: 'はじめての れんしゅう', desc: 'はじめて きろくした', icon: '🌱' },
  { id: 'streak_3', name: 'れんぞく 3にち', desc: '3にち つづけて れんしゅう', icon: '🔥' },
  { id: 'songs_5', name: 'いろいろな きょく', desc: '5きょく れんしゅうした', icon: '🎵' },
  { id: 'streak_7', name: 'れんぞく 7にち', desc: '7にち つづけて れんしゅう', icon: '⭐' },
  { id: 'challenge_100', name: '100かい チャレンジ', desc: 'ぜんぶで 100かい ひいた', icon: '💯' },
  { id: 'streak_14', name: 'れんぞく 14にち', desc: '14にち つづけて れんしゅう', icon: '🌈' },
  { id: 'songs_10', name: 'きょく 10きょく', desc: '10きょく れんしゅうした', icon: '🎼' },
  { id: 'big_day', name: 'がんばりや', desc: '1にちで 50かい ひいた', icon: '💪' },
  { id: 'month_30', name: '1かげつ がんばった', desc: '30にち きろくした', icon: '🏆' },
  { id: 'streak_30', name: 'れんぞく 30にち', desc: '30にち つづけて れんしゅう', icon: '👑' },
  { id: 'challenge_500', name: '500かい チャレンジ', desc: 'ぜんぶで 500かい ひいた', icon: '🚀' },
  { id: 'days_100', name: '100にち きろく', desc: '100にち きろくした', icon: '🎂' },
  { id: 'challenge_1000', name: '1000かい チャレンジ', desc: 'ぜんぶで 1000かい ひいた', icon: '🌟' },
];

export function badgeById(id) {
  return BADGES.find((b) => b.id === id) ?? null;
}

export function isEarned(state, id) {
  return (state?.badges ?? []).includes(id);
}

// カタログ順に取得状況を付与して返す
export function badgesWithStatus(state) {
  return BADGES.map((b) => ({ ...b, earned: isEarned(state, b.id) }));
}

export function earnedCount(state) {
  return BADGES.reduce((n, b) => n + (isEarned(state, b.id) ? 1 : 0), 0);
}

// 取得前後の badges 配列を比べ、新たに取得した（カタログに存在する）バッジを返す
export function newlyEarned(prevBadges = [], nextBadges = []) {
  const before = new Set(prevBadges);
  return nextBadges
    .filter((id) => !before.has(id) && badgeById(id))
    .map((id) => badgeById(id));
}

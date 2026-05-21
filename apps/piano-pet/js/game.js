// ===== ゲームロジック（純粋関数群） =====

// ----- レベル・XP -----

// 各レベルに到達するために必要な累計XP
function xpForLevel(level) {
  if (level <= 1) return 0;
  if (level === 2) return 20;
  if (level === 3) return 50;
  if (level === 4) return 90;
  if (level === 5) return 140;
  // レベル6以降：前レベルから+60ずつ
  return 140 + (level - 5) * 60;
}

export function calcLevel(totalXp) {
  let lv = 1;
  while (xpForLevel(lv + 1) <= totalXp) lv++;
  return lv;
}

// レベルバー表示用：現レベル内の進捗情報
export function xpProgress(totalXp) {
  const level = calcLevel(totalXp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  return {
    level,
    xpInLevel: totalXp - floor,
    xpPerLevel: ceiling - floor,
    toNextLevel: ceiling - totalXp,
  };
}

// ----- 猫の成長段階 -----

export function catStage(level) {
  if (level <= 5) return 'kitten';   // 子猫
  if (level <= 15) return 'young';   // 若猫
  return 'adult';                    // 成猫
}

// ----- ストリーク -----

export function updateStreak(streak, practiceDate) {
  const last = streak.lastPracticeDate;

  // 同日の二重記録はストリークを変化させない
  if (last === practiceDate) return { ...streak };

  const consecutive = last !== null && prevDay(practiceDate) === last;
  const current = consecutive ? streak.current + 1 : 1;
  return {
    current,
    best: Math.max(streak.best, current),
    lastPracticeDate: practiceDate,
  };
}

// ----- コイン・XP報酬計算 -----

export function calcRewards(totalCount, streakCurrent) {
  let coins = totalCount;
  let xp = totalCount;

  // 目標達成ボーナス（10回以上）
  if (totalCount >= 10) {
    coins += 5;
    xp += 3;
  }

  // ストリークマイルストーンボーナス（その日のストリークがちょうど達成した回数）
  if (streakCurrent === 7) coins += 30;
  else if (streakCurrent === 3) coins += 10;

  return { coins, xp };
}

// ----- バッジ判定 -----

export function checkBadges(state) {
  const earned = new Set(state.badges);
  const { sessions, streak } = state;

  if (sessions.length >= 1) earned.add('first_practice');

  const totalCount = sessions.reduce((s, r) => s + r.totalCount, 0);
  if (totalCount >= 100) earned.add('challenge_100');

  const bestStreak = Math.max(streak.current, streak.best);
  if (bestStreak >= 3) earned.add('streak_3');
  if (bestStreak >= 7) earned.add('streak_7');

  const uniqueDays = new Set(sessions.map((r) => r.date)).size;
  if (uniqueDays >= 30) earned.add('month_30');

  return [...earned];
}

// ----- セッション適用（state を受け取り新 state + 報酬を返す） -----

export function applySession(state, { date, songs, totalCount }) {
  const newStreak = updateStreak(state.streak, date);
  const { coins, xp } = calcRewards(totalCount, newStreak.current);

  const newXp = state.pet.xp + xp;
  const newLevel = calcLevel(newXp);

  const newPet = {
    ...state.pet,
    xp: newXp,
    level: newLevel,
    coins: state.pet.coins + coins,
  };

  const record = { date, songs, totalCount, coinsEarned: coins, xpEarned: xp };
  const partial = {
    ...state,
    pet: newPet,
    streak: newStreak,
    sessions: [record, ...state.sessions],
  };

  return {
    state: { ...partial, badges: checkBadges(partial) },
    rewards: { coins, xp, leveled: newLevel > state.pet.level, newLevel },
  };
}

// ----- ユーティリティ -----

// ローカルの暦日を YYYY-MM-DD で返す（UTC変換でズレないようローカル要素から組む）
export function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 日付文字列の前日を返す（UTC基準で計算するのでタイムゾーン非依存）
function prevDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

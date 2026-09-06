// ===== ゲームロジック（純粋関数群） =====

import { combineSongs, songTotals, isSongMaster, TEMPO_STAMPS, PRAISE_STAMPS } from './record-form.js';
import { affinityLevel } from './feed.js';
import { itemById } from './shop.js';

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

// ----- 今日の目標 -----

// 1日の練習目標（回数）の既定値。親が調整しないときの初期値（#238）。
export const DAILY_GOAL = 10;

// 親が調整できる目標回数の範囲（#238）。
export const MIN_DAILY_GOAL = 5;
export const MAX_DAILY_GOAL = 20;

// 目標達成ボーナスの閾値（#238で意図的に「固定10」に据え置き）。
// 可変目標（pet.dailyGoal）とは分離する。recomputeState は全履歴に calcRewards を
// 再適用するため、報酬閾値を可変目標に連動させると過去の記録のコインまで遡って
// 増減してしまう（下げれば水増し・上げれば娘のコインが減る）。表示上の目標だけを可変にし、
// 報酬計算はこの固定閾値で安定させる。
export const GOAL_BONUS_THRESHOLD = 10;

// 親が入力した目標回数を有効範囲（5〜20の整数）に丸める（#238）。
// 未設定（null/undefined/空文字）や数値化できない値は既定 DAILY_GOAL に落とす
// （Number(null)===0 の JS 仕様で「未設定」が最小値に化けるのを防ぐ）。
export function clampDailyGoal(value) {
  if (value === null || value === undefined || value === '') return DAILY_GOAL;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DAILY_GOAL;
  return Math.min(MAX_DAILY_GOAL, Math.max(MIN_DAILY_GOAL, n));
}

// その日の合計回数と目標への進捗を返す
export function dailyProgress(sessions, date, goal = DAILY_GOAL) {
  const count = (sessions ?? [])
    .filter((s) => s.date === date)
    .reduce((sum, s) => sum + (Number(s.totalCount) || 0), 0);
  return {
    count,
    goal,
    remaining: Math.max(0, goal - count),
    achieved: count >= goal,
    ratio: goal > 0 ? Math.min(1, count / goal) : 0,
  };
}

// その記録で「今日の目標にはじめて届いた」かを判定する（#227）。達成したあとの追加記録では
// false になり、同じ日に何度も動画が出ない。日付は常に todayStr() で測るので過去日の記録では
// 立たない（今日の合計が動かないため）。
export function crossedDailyGoal(prevSessions, nextSessions, date, goal) {
  return !dailyProgress(prevSessions, date, goal).achieved
      && dailyProgress(nextSessions, date, goal).achieved;
}

// ----- ストリーク -----

// 同時に持てるお休み券の上限
export const MAX_FREEZES = 2;

// お休み券を付与するマイルストーン（3日 / 7日ごと）
function isFreezeMilestone(streakCurrent) {
  return streakCurrent === 3 || (streakCurrent > 0 && streakCurrent % 7 === 0);
}

export function updateStreak(streak, practiceDate) {
  const last = streak.lastPracticeDate;
  const freezes = streak.freezes ?? 0;

  // 同日の二重記録はストリークを変化させない
  if (last === practiceDate) return { ...streak, freezes, frozeDays: 0 };

  // 初回、または前日に練習していれば連続
  if (last === null || prevDay(practiceDate) === last) {
    const current = last === null ? 1 : streak.current + 1;
    return { current, best: Math.max(streak.best, current), lastPracticeDate: practiceDate, freezes, frozeDays: 0 };
  }

  // 間が空いた：抜けた日数ぶんのお休み券があれば連続を維持（消費）
  const missed = dayDiff(last, practiceDate) - 1;
  if (missed >= 1 && freezes >= missed) {
    const current = streak.current + 1;
    return {
      current,
      best: Math.max(streak.best, current),
      lastPracticeDate: practiceDate,
      freezes: freezes - missed,
      frozeDays: missed,
    };
  }

  // 救済できない → 1からリセット
  return { current: 1, best: Math.max(streak.best, 1), lastPracticeDate: practiceDate, freezes, frozeDays: 0 };
}

// ----- コイン・XP報酬計算 -----

export function calcRewards(totalCount, streakCurrent) {
  let coins = totalCount;
  let xp = totalCount;

  // 目標達成ボーナス（GOAL_BONUS_THRESHOLD=10 回以上・固定）。
  // 可変目標（pet.dailyGoal）とは分離＝過去の記録を再計算しても金額が動かない（#238）。
  if (totalCount >= GOAL_BONUS_THRESHOLD) {
    coins += 5;
    xp += 3;
  }

  // ストリークマイルストーンボーナス（その日のストリークがちょうど達成した回数）
  if (streakCurrent === 7) coins += 30;
  else if (streakCurrent === 3) coins += 10;

  return { coins, xp };
}

// ----- きょうのおまけ（#148） -----

// 練習した日だけ低確率で猫がくれるプチ報酬コイン。
export const BONUS_CHANCE = 0.2; // 低確率（その日初回の記録でのみ抽選）
export const BONUS_COINS = 3;    // 既存コインを流用したプチ報酬

// 0..1 の乱数を受け取り、当たれば付与コイン、外れれば0を返す（純粋関数・テスト可能）。
export function rollDailyBonus(roll) {
  return roll < BONUS_CHANCE ? BONUS_COINS : 0;
}

// ----- バッジ判定 -----

// 3日以上のブランク（カレンダー上の素の日付間隔。お休み券の救済は考慮しない）のあと、
// 3日以上連続で記録できた実績があるか（#309・comeback）。streak.current/best は
// お休み券で救済された連続も等しく含むため、既存の streak_* とは別に「本当に途切れた
// あとの立て直し」だけをここで検出する。
function hadComeback(sessions) {
  const dates = [...new Set(sessions.map((s) => s.date))].sort();
  let run = 1;
  let sawGap = false;
  for (let i = 1; i < dates.length; i += 1) {
    const missed = dayDiff(dates[i - 1], dates[i]) - 1;
    if (missed >= 3) {
      sawGap = true;
      run = 1;
    } else if (missed === 0) {
      run += 1;
    } else {
      run = 1;
    }
    if (sawGap && run >= 3) return true;
  }
  return false;
}

export function checkBadges(state) {
  const earned = new Set(state.badges);
  const { sessions, streak, pet } = state;

  if (sessions.length >= 1) earned.add('first_practice');

  const uniqueDays = new Set(sessions.map((r) => r.date)).size;
  if (uniqueDays >= 2) earned.add('practice_again');

  const totalCount = sessions.reduce((s, r) => s + (Number(r.totalCount) || 0), 0);
  if (totalCount >= 100) earned.add('challenge_100');
  if (totalCount >= 500) earned.add('challenge_500');
  if (totalCount >= 1000) earned.add('challenge_1000');

  const bestStreak = Math.max(streak.current, streak.best);
  if (bestStreak >= 3) earned.add('streak_3');
  if (bestStreak >= 7) earned.add('streak_7');
  if (bestStreak >= 14) earned.add('streak_14');
  if (bestStreak >= 30) earned.add('streak_30');

  if (uniqueDays >= 30) earned.add('month_30');
  if (uniqueDays >= 50) earned.add('days_50');
  if (uniqueDays >= 100) earned.add('days_100');

  // sessions は同日を1件にまとめてあるので totalCount はその日の合計そのもの
  if (sessions.some((r) => (Number(r.totalCount) || 0) >= 50)) earned.add('big_day');

  // 可変 pet.dailyGoal ではなく固定閾値を使う（#238と同じ理由＝目標変更で過去の資格が動かない）
  const goalDays = sessions.filter((r) => (Number(r.totalCount) || 0) >= GOAL_BONUS_THRESHOLD).length;
  if (goalDays >= 5) earned.add('goal_hit_5');

  // 曲名は trim だけして比べる（song-color.js の songHue と同じ扱い＝別の色がつく曲は別の曲）
  const songNames = new Set();
  let maxDaySongs = 0;
  for (const r of sessions) {
    const dayNames = new Set();
    for (const song of r.songs ?? []) {
      const name = String(song?.name ?? '').trim();
      if (name) {
        songNames.add(name);
        dayNames.add(name);
      }
    }
    maxDaySongs = Math.max(maxDaySongs, dayNames.size);
  }
  if (songNames.size >= 5) earned.add('songs_5');
  if (songNames.size >= 10) earned.add('songs_10');
  if (songNames.size >= 20) earned.add('songs_20');
  if (maxDaySongs >= 5) earned.add('repertoire_day_5');

  if (songTotals(sessions).some((s) => isSongMaster(s.count))) earned.add('song_master_first');

  const tempos = new Set(sessions.map((r) => r.tempo).filter(Boolean));
  if (TEMPO_STAMPS.every((t) => tempos.has(t.id))) earned.add('tempo_all3');

  const praises = new Set(sessions.map((r) => r.praise).filter(Boolean));
  if (PRAISE_STAMPS.every((p) => praises.has(p.id))) earned.add('praise_all3');

  // equippedItems（装備中）は外すと減る可逆トグルなので使わない。inventory（所持）は
  // 購入を取り消す手段が無く単調増加＝一度取ったバッジが着せ替えで剥がれない（#309レビュー）。
  const hasWearable = (state.inventory ?? []).some((id) => itemById(id)?.slot !== 'scene');
  if (hasWearable) earned.add('first_outfit');
  if (affinityLevel(pet?.affinity ?? 0).isMax) earned.add('affinity_max');

  if (hadComeback(sessions)) earned.add('comeback');

  return [...earned];
}

// ----- セッション適用（state を受け取り新 state + 報酬を返す） -----

export function applySession(state, { date, songs, totalCount }, bonusCoins = 0) {
  const updated = updateStreak(state.streak, date);
  const { coins, xp } = calcRewards(totalCount, updated.current);

  // マイルストーン到達でお休み券を付与（上限まで）
  const granted = isFreezeMilestone(updated.current) ? 1 : 0;
  const freezes = Math.min(MAX_FREEZES, updated.freezes + granted);
  const newStreak = {
    current: updated.current,
    best: updated.best,
    lastPracticeDate: updated.lastPracticeDate,
    freezes,
  };

  const newXp = state.pet.xp + xp;
  const newLevel = calcLevel(newXp);

  const newPet = {
    ...state.pet,
    xp: newXp,
    level: newLevel,
    coins: state.pet.coins + coins + bonusCoins,
  };

  // bonusCoins は乱数由来のため記録に保存し、全再計算（recomputeState）で復元する
  const record = { date, songs, totalCount, coinsEarned: coins, xpEarned: xp, bonusCoins };
  const partial = {
    ...state,
    pet: newPet,
    streak: newStreak,
    sessions: [record, ...state.sessions],
  };

  return {
    state: { ...partial, badges: checkBadges(partial) },
    rewards: {
      coins,
      xp,
      leveled: newLevel > state.pet.level,
      newLevel,
      frozeDays: updated.frozeDays,
      freezeGranted: freezes - updated.freezes,
      bonus: bonusCoins,
    },
  };
}

// ----- 全再計算（編集・削除後の整合用） -----

// sessions を唯一の正として、XP・レベル・コイン・ストリーク・バッジを
// ゼロから再計算する。記録を日付昇順で再生し applySession と同じ規則を辿る。
// spent は購入済みアイテムに使ったコイン総額（所持コイン = 獲得総額 - spent）。
export function recomputeState(state, spent = 0) {
  const sessions = state.sessions ?? [];

  // 元の並びは保ちつつ、再生は日付昇順で行う（同日の相対順は安定ソートで保持）
  const order = sessions.map((_, i) => i)
    .sort((a, b) => String(sessions[a].date).localeCompare(String(sessions[b].date)));

  let streak = { current: 0, best: 0, lastPracticeDate: null, freezes: 0 };
  let totalXp = 0;
  let earned = 0;
  const recomputed = sessions.slice();

  for (const i of order) {
    const s = sessions[i];
    const updated = updateStreak(streak, s.date);
    const { coins, xp } = calcRewards(s.totalCount, updated.current);
    const granted = isFreezeMilestone(updated.current) ? 1 : 0;
    streak = {
      current: updated.current,
      best: updated.best,
      lastPracticeDate: updated.lastPracticeDate,
      freezes: Math.min(MAX_FREEZES, updated.freezes + granted),
    };
    totalXp += xp;
    earned += coins + (s.bonusCoins || 0); // きょうのおまけ（#148）は保存値を保持
    recomputed[i] = { ...s, coinsEarned: coins, xpEarned: xp };
  }

  const partial = {
    ...state,
    pet: {
      ...state.pet,
      xp: totalXp,
      level: calcLevel(totalXp),
      coins: Math.max(0, earned - spent),
    },
    streak,
    sessions: recomputed,
    badges: [], // バッジは sessions から取り直す（資格を失えば剥がれる）
  };
  return { ...partial, badges: checkBadges(partial) };
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

// 2つの日付文字列の差（日数）。to が from より後なら正（UTC基準）。
function dayDiff(fromStr, toStr) {
  const a = Date.parse(fromStr + 'T00:00:00Z');
  const b = Date.parse(toStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// ----- 同日セッション統合 -----

// sessions 配列内の同じ日付のエントリを1件にまとめる（songs・totalCount を合算）。
// 変化がなければ元の配列参照をそのまま返す。
export function mergeSameDaySessions(sessions) {
  const seen = new Map();
  const result = [];
  for (const s of sessions) {
    const d = s.date;
    if (!seen.has(d)) {
      seen.set(d, result.length);
      result.push({ ...s, songs: [...(s.songs ?? [])], totalCount: Number(s.totalCount) || 0 });
    } else {
      const idx = seen.get(d);
      const prev = result[idx];
      result[idx] = {
        ...prev,
        // 同日同曲は1行に合算する（#186）
        songs: combineSongs([...prev.songs, ...(s.songs ?? [])]),
        totalCount: prev.totalCount + (Number(s.totalCount) || 0),
        // 付与値は非nullを勝たせる（#315・設計判断は docs/data-model.md）。...prev だけだと
        // 先勝ち側の値で上書きされ、当たったおまけ・親のスタンプが無言で消える。
        bonusCoins: Math.max(Number(prev.bonusCoins) || 0, Number(s.bonusCoins) || 0),
        praise: prev.praise ?? s.praise ?? null,
        tempo: prev.tempo ?? s.tempo ?? null,
      };
    }
  }
  return result.length === sessions.length ? sessions : result;
}

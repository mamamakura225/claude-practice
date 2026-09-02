import { describe, it, expect } from 'vitest';
import {
  calcLevel,
  xpProgress,
  updateStreak,
  calcRewards,
  applySession,
  recomputeState,
  MAX_FREEZES,
  dailyProgress,
  mergeSameDaySessions,
  rollDailyBonus,
  BONUS_CHANCE,
  BONUS_COINS,
  clampDailyGoal,
  crossedDailyGoal,
  checkBadges,
  GOAL_BONUS_THRESHOLD,
  DAILY_GOAL,
} from '../js/game.js';

function baseState(overrides = {}) {
  return {
    pet: { name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [] },
    inventory: [],
    streak: { current: 0, best: 0, lastPracticeDate: null },
    badges: [],
    sessions: [],
    ...overrides,
  };
}

describe('calcLevel / xpProgress', () => {
  it('XP閾値に応じてレベルが上がる', () => {
    expect(calcLevel(0)).toBe(1);
    expect(calcLevel(19)).toBe(1);
    expect(calcLevel(20)).toBe(2);
    expect(calcLevel(50)).toBe(3);
    expect(calcLevel(140)).toBe(5);
  });

  it('レベル6以降は+60ずつ', () => {
    expect(calcLevel(200)).toBe(6);
    expect(calcLevel(260)).toBe(7);
  });

  it('現レベル内の進捗とレベルアップまでの残りを返す', () => {
    const p = xpProgress(30); // レベル2 (20-50)
    expect(p.level).toBe(2);
    expect(p.xpInLevel).toBe(10);
    expect(p.xpPerLevel).toBe(30);
    expect(p.toNextLevel).toBe(20);
  });
});

describe('dailyProgress', () => {
  const sessions = [
    { date: '2026-05-22', totalCount: 4 },
    { date: '2026-05-22', totalCount: 3 },
    { date: '2026-05-21', totalCount: 9 },
  ];

  it('その日の合計を集計し、残り回数を返す', () => {
    const p = dailyProgress(sessions, '2026-05-22');
    expect(p.count).toBe(7);
    expect(p.remaining).toBe(3);
    expect(p.achieved).toBe(false);
    expect(p.ratio).toBeCloseTo(0.7);
  });

  it('目標到達で achieved=true、残り0、ratioは1で頭打ち', () => {
    const p = dailyProgress([{ date: '2026-05-22', totalCount: 12 }], '2026-05-22');
    expect(p.count).toBe(12);
    expect(p.remaining).toBe(0);
    expect(p.achieved).toBe(true);
    expect(p.ratio).toBe(1);
  });

  it('記録のない日は0', () => {
    const p = dailyProgress(sessions, '2026-05-20');
    expect(p.count).toBe(0);
    expect(p.remaining).toBe(10);
    expect(p.achieved).toBe(false);
  });
});

describe('calcRewards', () => {
  it('1回=1コイン1XP', () => {
    expect(calcRewards(3, 1)).toEqual({ coins: 3, xp: 3 });
  });

  it('10回以上で目標達成ボーナス(+5コイン +3XP)', () => {
    expect(calcRewards(10, 1)).toEqual({ coins: 15, xp: 13 });
  });

  it('ストリーク3日でちょうど+10コイン', () => {
    expect(calcRewards(5, 3)).toEqual({ coins: 15, xp: 5 });
  });

  it('ストリーク7日でちょうど+30コイン', () => {
    expect(calcRewards(5, 7)).toEqual({ coins: 35, xp: 5 });
  });
});

describe('updateStreak', () => {
  it('前日に練習していれば連続が伸びる', () => {
    const s = updateStreak({ current: 2, best: 2, lastPracticeDate: '2026-05-21' }, '2026-05-22');
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
  });

  it('間が空いたらリセットして1から', () => {
    const s = updateStreak({ current: 5, best: 5, lastPracticeDate: '2026-05-19' }, '2026-05-22');
    expect(s.current).toBe(1);
    expect(s.best).toBe(5);
  });

  it('同じ日の二重記録はストリークを変えない', () => {
    const s = updateStreak({ current: 3, best: 3, lastPracticeDate: '2026-05-22' }, '2026-05-22');
    expect(s.current).toBe(3);
  });
});

describe('updateStreak: お休み券による救済', () => {
  it('1日抜けてもお休み券があれば連続を維持し、券を1枚消費する', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-20', freezes: 1 },
      '2026-05-22', // 5-21 が抜け
    );
    expect(s.current).toBe(6);
    expect(s.freezes).toBe(0);
    expect(s.frozeDays).toBe(1);
  });

  it('券がなければ1日抜けでリセット', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-20', freezes: 0 },
      '2026-05-22',
    );
    expect(s.current).toBe(1);
    expect(s.frozeDays).toBe(0);
  });

  it('抜けた日数より券が少なければリセット（券は維持）', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-19', freezes: 1 },
      '2026-05-22', // 2日抜け
    );
    expect(s.current).toBe(1);
    expect(s.freezes).toBe(1);
  });

  it('2日抜けでも券が2枚あれば維持し、2枚消費', () => {
    const s = updateStreak(
      { current: 5, best: 5, lastPracticeDate: '2026-05-19', freezes: 2 },
      '2026-05-22',
    );
    expect(s.current).toBe(6);
    expect(s.freezes).toBe(0);
    expect(s.frozeDays).toBe(2);
  });
});

describe('applySession', () => {
  it('コイン・XPを加算し、セッションを先頭に積む', () => {
    const { state, rewards } = applySession(baseState(), {
      date: '2026-05-22',
      songs: [{ name: 'きらきら星', count: 5 }],
      totalCount: 5,
    });
    expect(rewards.coins).toBe(5);
    expect(rewards.xp).toBe(5);
    expect(state.pet.coins).toBe(5);
    expect(state.pet.xp).toBe(5);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      date: '2026-05-22',
      totalCount: 5,
      coinsEarned: 5,
      xpEarned: 5,
    });
  });

  it('XPがしきい値を超えるとレベルアップを報告する', () => {
    const start = baseState({ pet: { name: 'き', level: 1, xp: 18, coins: 0, equippedItems: [] } });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 5 }],
      totalCount: 5,
    });
    expect(state.pet.xp).toBe(23);
    expect(state.pet.level).toBe(2);
    expect(rewards.leveled).toBe(true);
    expect(rewards.newLevel).toBe(2);
  });

  it('初回記録で first_practice バッジが付く', () => {
    const { state } = applySession(baseState(), {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 1 }],
      totalCount: 1,
    });
    expect(state.badges).toContain('first_practice');
  });

  it('元のstateを変更しない（イミュータブル）', () => {
    const start = baseState();
    applySession(start, { date: '2026-05-22', songs: [{ name: 'A', count: 3 }], totalCount: 3 });
    expect(start.pet.coins).toBe(0);
    expect(start.sessions).toHaveLength(0);
  });

  it('3日連続のマイルストーンでお休み券を1枚付与する', () => {
    const start = baseState({
      streak: { current: 2, best: 2, lastPracticeDate: '2026-05-21', freezes: 0 },
    });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 2 }],
      totalCount: 2,
    });
    expect(state.streak.current).toBe(3);
    expect(state.streak.freezes).toBe(1);
    expect(rewards.freezeGranted).toBe(1);
  });

  it('お休み券は上限を超えて付与されない', () => {
    const start = baseState({
      streak: { current: 2, best: 2, lastPracticeDate: '2026-05-21', freezes: MAX_FREEZES },
    });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 2 }],
      totalCount: 2,
    });
    expect(state.streak.freezes).toBe(MAX_FREEZES);
    expect(rewards.freezeGranted).toBe(0);
  });

  it('抜けた日を救済したら rewards.frozeDays に反映する', () => {
    const start = baseState({
      streak: { current: 5, best: 5, lastPracticeDate: '2026-05-20', freezes: 1 },
    });
    const { state, rewards } = applySession(start, {
      date: '2026-05-22',
      songs: [{ name: 'A', count: 2 }],
      totalCount: 2,
    });
    expect(state.streak.current).toBe(6);
    expect(state.streak.freezes).toBe(0);
    expect(rewards.frozeDays).toBe(1);
  });
});

describe('rollDailyBonus（きょうのおまけ #148）', () => {
  it('しきい値未満で当たり＝プチ報酬コインを返す', () => {
    expect(rollDailyBonus(0)).toBe(BONUS_COINS);
    expect(rollDailyBonus(BONUS_CHANCE - 0.0001)).toBe(BONUS_COINS);
  });

  it('しきい値以上は外れ＝0', () => {
    expect(rollDailyBonus(BONUS_CHANCE)).toBe(0);
    expect(rollDailyBonus(0.99)).toBe(0);
  });
});

describe('applySession × きょうのおまけ', () => {
  it('bonusCoins を所持コインに上乗せし、記録と rewards に保存する', () => {
    const { state, rewards } = applySession(
      baseState(),
      { date: '2026-05-22', songs: [{ name: 'A', count: 5 }], totalCount: 5 },
      BONUS_COINS,
    );
    expect(rewards.bonus).toBe(BONUS_COINS);
    expect(state.pet.coins).toBe(5 + BONUS_COINS); // 基本5 + おまけ
    expect(state.sessions[0].bonusCoins).toBe(BONUS_COINS);
    expect(state.sessions[0].coinsEarned).toBe(5); // coinsEarned は基本分のみ
  });

  it('bonus 省略時は 0 で従来通り', () => {
    const { state, rewards } = applySession(
      baseState(),
      { date: '2026-05-22', songs: [{ name: 'A', count: 5 }], totalCount: 5 },
    );
    expect(rewards.bonus).toBe(0);
    expect(state.pet.coins).toBe(5);
  });

  it('recomputeState は保存した bonusCoins を所持コインに復元する', () => {
    const { state } = applySession(
      baseState(),
      { date: '2026-05-22', songs: [{ name: 'A', count: 5 }], totalCount: 5 },
      BONUS_COINS,
    );
    const after = recomputeState(state, 0);
    expect(after.pet.coins).toBe(5 + BONUS_COINS); // 再計算で消えない
    expect(after.sessions[0].bonusCoins).toBe(BONUS_COINS);
  });
});

describe('mergeSameDaySessions', () => {
  it('重複がなければ同一参照を返す', () => {
    const sessions = [
      { date: '2026-05-22', songs: [], totalCount: 5 },
      { date: '2026-05-21', songs: [], totalCount: 3 },
    ];
    expect(mergeSameDaySessions(sessions)).toBe(sessions);
  });

  it('空配列はそのまま返す', () => {
    const sessions = [];
    expect(mergeSameDaySessions(sessions)).toBe(sessions);
  });

  it('同日2件を統合し、songs と totalCount を合算する', () => {
    const sessions = [
      { date: '2026-05-22', songs: [{ name: 'A', count: 5 }], totalCount: 5 },
      { date: '2026-05-22', songs: [{ name: 'B', count: 3 }], totalCount: 3 },
      { date: '2026-05-21', songs: [{ name: 'C', count: 7 }], totalCount: 7 },
    ];
    const result = mergeSameDaySessions(sessions);
    expect(result).toHaveLength(2);
    const day22 = result.find((s) => s.date === '2026-05-22');
    expect(day22.totalCount).toBe(8);
    expect(day22.songs).toHaveLength(2);
    expect(day22.songs[0].name).toBe('A');
    expect(day22.songs[1].name).toBe('B');
    const day21 = result.find((s) => s.date === '2026-05-21');
    expect(day21.totalCount).toBe(7);
  });

  it('統合後に recomputeState すると目標達成ボーナスが1回のみ付与される', () => {
    // 同日に10回 + 10回 の重複セッション（旧バグ状態）
    const buggyState = {
      ...baseState(),
      sessions: [
        { date: '2026-05-22', songs: [{ name: 'A', count: 10 }], totalCount: 10, coinsEarned: 0, xpEarned: 0 },
        { date: '2026-05-22', songs: [{ name: 'B', count: 10 }], totalCount: 10, coinsEarned: 0, xpEarned: 0 },
      ],
    };
    const merged = mergeSameDaySessions(buggyState.sessions);
    expect(merged).toHaveLength(1);
    const fixed = recomputeState({ ...buggyState, sessions: merged }, 0);
    // 合計20回 + 目標ボーナス5コイン = 25（二重取りなし）
    expect(fixed.pet.coins).toBe(25);
    expect(fixed.pet.xp).toBe(23); // 20 + 3
  });
});

describe('recomputeState', () => {
  function buildHistory(dates, counts) {
    let s = baseState();
    dates.forEach((d, i) => {
      s = applySession(s, { date: d, songs: [{ name: 'A', count: counts[i] }], totalCount: counts[i] }).state;
    });
    return s;
  }

  it('逐次 applySession と同じ XP・コイン・レベル・ストリークを再現する', () => {
    const live = buildHistory(['2026-05-20', '2026-05-21', '2026-05-22'], [5, 5, 12]);
    const recomputed = recomputeState(live, 0);
    expect(recomputed.pet.xp).toBe(live.pet.xp);
    expect(recomputed.pet.coins).toBe(live.pet.coins);
    expect(recomputed.pet.level).toBe(live.pet.level);
    expect(recomputed.streak.current).toBe(live.streak.current);
    expect(recomputed.streak.freezes).toBe(live.streak.freezes);
  });

  it('セッションを削除すると XP・コイン・ストリークが再計算される', () => {
    const live = buildHistory(['2026-05-21', '2026-05-22'], [5, 5]);
    const sessions = live.sessions.filter((s) => s.date !== '2026-05-22');
    const after = recomputeState({ ...live, sessions }, 0);
    expect(after.sessions).toHaveLength(1);
    expect(after.pet.xp).toBe(5);
    expect(after.pet.coins).toBe(5);
    expect(after.streak.current).toBe(1);
  });

  it('購入に使ったコイン(spent)を差し引き、マイナスにはしない', () => {
    const live = buildHistory(['2026-05-22'], [12]); // 獲得 17 コイン
    expect(recomputeState(live, 10).pet.coins).toBe(7);
    expect(recomputeState(live, 50).pet.coins).toBe(0);
  });

  it('資格を失ったバッジは剥がれる', () => {
    const live = buildHistory(['2026-05-22'], [3]);
    expect(live.badges).toContain('first_practice');
    const after = recomputeState({ ...live, sessions: [] }, 0);
    expect(after.badges).not.toContain('first_practice');
  });
});

describe('clampDailyGoal（1日の目標回数・#238）', () => {
  it('5〜20 の範囲はそのまま（整数化）', () => {
    expect(clampDailyGoal(5)).toBe(5);
    expect(clampDailyGoal(10)).toBe(10);
    expect(clampDailyGoal(20)).toBe(20);
    expect(clampDailyGoal(12.4)).toBe(12);
  });

  it('範囲外は 5〜20 にクランプ', () => {
    expect(clampDailyGoal(1)).toBe(5);
    expect(clampDailyGoal(0)).toBe(5);
    expect(clampDailyGoal(100)).toBe(20);
  });

  it('不正値は既定(DAILY_GOAL=10)に落とす', () => {
    expect(clampDailyGoal(undefined)).toBe(DAILY_GOAL);
    expect(clampDailyGoal(null)).toBe(DAILY_GOAL);
    expect(clampDailyGoal('abc')).toBe(DAILY_GOAL);
    expect(clampDailyGoal(NaN)).toBe(DAILY_GOAL);
  });

  it('達成ボーナス閾値は固定10で、可変目標とは分離（過去コイン不変・#238）', () => {
    // 目標を下げても上げても calcRewards のボーナスは totalCount>=10 で判定される。
    expect(GOAL_BONUS_THRESHOLD).toBe(10);
    expect(calcRewards(9, 1).coins).toBe(9);        // 9回はボーナス無し
    expect(calcRewards(10, 1).coins).toBe(10 + 5);  // 10回で+5（目標設定に依らず）
  });
});

describe('crossedDailyGoal（#227）', () => {
  const TODAY = '2026-09-01';
  const s = (date, totalCount) => ({ date, totalCount });

  it('未達 → 達成 で true（この記録ではじめて届いた）', () => {
    const prev = [s(TODAY, 7)];
    const next = [s(TODAY, 10)];
    expect(crossedDailyGoal(prev, next, TODAY, 10)).toBe(true);
  });

  it('達成済み → さらに追加 で false（同じ日に何度も出さない）', () => {
    const prev = [s(TODAY, 10)];
    const next = [s(TODAY, 13)];
    expect(crossedDailyGoal(prev, next, TODAY, 10)).toBe(false);
  });

  it('未達 → 未達 で false', () => {
    expect(crossedDailyGoal([s(TODAY, 3)], [s(TODAY, 6)], TODAY, 10)).toBe(false);
  });

  it('初回記録（今日のセッションが無い状態）から一気に達成でも true', () => {
    expect(crossedDailyGoal([], [s(TODAY, 10)], TODAY, 10)).toBe(true);
  });

  it('過去日の記録では立たない（今日の合計が動かない）', () => {
    const past = '2026-08-20';
    const prev = [s(TODAY, 2)];
    const next = [s(TODAY, 2), s(past, 10)];
    expect(crossedDailyGoal(prev, next, TODAY, 10)).toBe(false);
  });
});

describe('checkBadges（中〜長期バッジ・#298）', () => {
  // checkBadges は date を「その日を表す一意キー」としてしか使わない（パースしない）
  const day = (i) => `2026-01-${i}`;
  const stateOf = ({ sessions = [], current = 0, best = 0 } = {}) =>
    ({ badges: [], sessions, streak: { current, best } });
  const days = (n, totalCount = 1) =>
    Array.from({ length: n }, (_, i) => ({ date: day(i + 1), totalCount }));
  const withSongNames = (names) => stateOf({
    sessions: names.map((name, i) => ({ date: day(i + 1), totalCount: 1, songs: [{ name, count: 1 }] })),
  });
  const songNames = (n) => Array.from({ length: n }, (_, i) => `きょく${i + 1}`);

  it('連続日数で streak_14 / streak_30 が取れる', () => {
    expect(checkBadges(stateOf({ current: 13, best: 13 }))).not.toContain('streak_14');
    expect(checkBadges(stateOf({ current: 14, best: 14 }))).toContain('streak_14');
    expect(checkBadges(stateOf({ current: 29, best: 29 }))).not.toContain('streak_30');
    // 途切れたあとでも best 側で残る（既存 streak_3/7 と同じ扱い）
    expect(checkBadges(stateOf({ current: 1, best: 30 }))).toContain('streak_30');
  });

  it('累計回数で challenge_500 / challenge_1000 が取れる', () => {
    const at = (total) => checkBadges(stateOf({ sessions: [{ date: day(1), totalCount: total }] }));
    expect(at(499)).not.toContain('challenge_500');
    expect(at(500)).toContain('challenge_500');
    expect(at(999)).not.toContain('challenge_1000');
    expect(at(1000)).toContain('challenge_1000');
  });

  it('記録した日数で days_100 が取れる', () => {
    expect(checkBadges(stateOf({ sessions: days(99) }))).not.toContain('days_100');
    expect(checkBadges(stateOf({ sessions: days(100) }))).toContain('days_100');
  });

  it('big_day は累計ではなく1日ぶんの回数で判定する', () => {
    // 合計 98 回だがどの日も 50 未満なので取れない
    const spread = [{ date: day(1), totalCount: 49 }, { date: day(2), totalCount: 49 }];
    expect(checkBadges(stateOf({ sessions: spread }))).not.toContain('big_day');
    expect(checkBadges(stateOf({ sessions: [{ date: day(1), totalCount: 50 }] }))).toContain('big_day');
  });

  it('曲名の種類数で songs_5 / songs_10 が取れる', () => {
    expect(checkBadges(withSongNames(songNames(4)))).not.toContain('songs_5');
    expect(checkBadges(withSongNames(songNames(5)))).toContain('songs_5');
    expect(checkBadges(withSongNames(songNames(9)))).not.toContain('songs_10');
    expect(checkBadges(withSongNames(songNames(10)))).toContain('songs_10');
  });

  it('前後の空白ちがいは同じ曲として数え、空名は数えない', () => {
    const sessions = [
      { date: day(1), totalCount: 4, songs: [
        { name: 'ちょうちょう', count: 1 },
        { name: ' ちょうちょう ', count: 1 },
        { name: '   ', count: 1 },
        { name: 'かえるのうた', count: 1 },
      ] },
      { date: day(2), totalCount: 2, songs: [
        { name: 'きらきらぼし', count: 1 },
        { name: 'ぶんぶんぶん', count: 1 },
      ] },
    ];
    // 実質4種類。素朴に数えると6種になり songs_5 を誤って取ってしまう
    expect(checkBadges(stateOf({ sessions }))).not.toContain('songs_5');
  });

  it('songs を持たない記録が混ざっても落ちない', () => {
    expect(() => checkBadges(stateOf({ sessions: [{ date: day(1), totalCount: 5 }] }))).not.toThrow();
  });

  it('recomputeState 経由でも取得し、資格を失えば剥がれる', () => {
    const songs = songNames(5).map((name) => ({ name, count: 12 }));
    const sessions = [{ date: '2026-05-01', songs, totalCount: 60 }];
    const live = recomputeState({ ...baseState(), sessions }, 0);
    expect(live.badges).toEqual(expect.arrayContaining(['big_day', 'songs_5']));

    const shrunk = [{ date: '2026-05-01', songs: [{ name: 'ちょうちょう', count: 3 }], totalCount: 3 }];
    const after = recomputeState({ ...live, sessions: shrunk }, 0);
    expect(after.badges).not.toContain('big_day');
    expect(after.badges).not.toContain('songs_5');
  });
});

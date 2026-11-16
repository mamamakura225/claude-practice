// ねこスタンプちょう（#409）の純粋ロジック。設計判断は docs/features.md

export const STAMP_THRESHOLD = 10;
export const CARD_MIN = 5;
export const CARD_MAX = 60;

export const REWARD_EMOJIS = ['🎁', '🍦', '🧸', '📚', '🎡', '🍰', '🚗', '🦁'];
export const REWARD_MAX_LEN = 20;

// 猫の姿16種（色は姿ごとに固定）。#410 で水彩画像へ差し替える
export const STAMP_INKS = { red: '#d8434b', blue: '#3b6fd8', green: '#2f8a52', purple: '#8a55c9', brown: '#93622f' };
export const STAMP_DESIGNS = [
  ['nenne', 'ねんね', '💤', 'red'],
  ['nobi', 'のび〜', '✨', 'blue'],
  ['piano', 'ピアノ', '🎹', 'green'],
  ['sakana', 'おさかな', '🐟', 'purple'],
  ['keito', 'けいとだま', '🧶', 'brown'],
  ['hako', 'はこ', '📦', 'red'],
  ['banzai', 'ばんざい', '🙌', 'blue'],
  ['ojigi', 'おじぎ', '🎀', 'green'],
  ['fumifumi', 'ふみふみ', '🐾', 'purple'],
  ['marui', 'まるくなる', '🌙', 'brown'],
  ['punch', 'ねこパンチ', '💥', 'red'],
  ['onpu', 'おんぷ', '🎵', 'blue'],
  ['kaoarai', 'かおあらい', '🫧', 'green'],
  ['osuwari', 'おすわり', '⭐', 'purple'],
  ['heart', 'しっぽハート', '💗', 'brown'],
  ['jump', 'ジャンプ', '🌈', 'red'],
].map(([id, name, mark, ink]) => ({ id, name, mark, ink }));

export const clampCardSize = (v) => Math.min(CARD_MAX, Math.max(CARD_MIN, Math.round(Number(v)) || 10));
export const normalizeRewardEmoji = (e) => (REWARD_EMOJIS.includes(e) ? e : REWARD_EMOJIS[0]);
export const normalizeReward = (s) => String(s ?? '').trim().slice(0, REWARD_MAX_LEN);

const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
const dateOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const nextDay = (date) => dateOf(dayNumber(date) + 1);
// 書式は正しいが実在しない日付（2026-11-00 等・信頼できない入力）は数えない
const realDate = (d) => Number.isFinite(dayNumber(d));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 日付→絵柄（保存しない）。16日ごとのブロック内では同じ絵が出ない
export function designForDate(date) {
  const n = dayNumber(date);
  const N = STAMP_DESIGNS.length;
  const block = Math.floor(n / N);
  const order = STAMP_DESIGNS.map((_, i) => i);
  const rand = rng(block + 1);
  for (let i = N - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return STAMP_DESIGNS[order[((n % N) + N) % N]] ?? STAMP_DESIGNS[0];
}

function dailyTotals(sessions) {
  const m = new Map();
  for (const s of sessions ?? []) if (realDate(s.date)) m.set(s.date, (m.get(s.date) ?? 0) + (Number(s.totalCount) || 0));
  return m;
}

export function eligibleDates(sessions, card, today) {
  if (!card) return [];
  return [...dailyTotals(sessions)]
    .filter(([d, n]) => n >= STAMP_THRESHOLD && d >= card.startDate && d <= today)
    .map(([d]) => d)
    .sort()
    .slice(0, card.size);
}

export function cardStatus(state, today) {
  const book = state.pet.stampBook;
  const card = book?.card ?? null;
  const todayCount = dailyTotals(state.sessions).get(today) ?? 0;
  if (!card) return { card: null, slots: [], pressedCount: 0, pendingCount: 0, full: false, todayCount };
  const pressed = new Set(book.pressed);
  const slots = eligibleDates(state.sessions, card, today)
    .map((date) => ({ date, design: designForDate(date), pressed: pressed.has(date) }));
  const pressedCount = slots.filter((s) => s.pressed).length;
  return {
    card,
    slots,
    pressedCount,
    pendingCount: slots.length - pressedCount,
    full: slots.length >= card.size && pressedCount === slots.length,
    todayCount,
    todayStamped: slots.some((s) => s.date === today),
  };
}

export function pressStamp(book, date) {
  return { ...book, pressed: [...new Set([...book.pressed, date])].sort() };
}

// 前のカードの最後のスタンプの翌日（持ち越し）。初めては今日
export function nextStartDate(book, today) {
  const last = book.done.flatMap((c) => c.dates).filter(realDate).sort().at(-1);
  return last ? nextDay(last) : today;
}

export function saveCard(book, { reward, emoji, size }, today, now = Date.now()) {
  const fields = { reward: normalizeReward(reward), emoji: normalizeRewardEmoji(emoji), size: clampCardSize(size) };
  const card = book.card
    ? { ...book.card, ...fields }
    : { id: now, startDate: nextStartDate(book, today), ...fields };
  return { ...book, card };
}

export function redeemCard(state, today) {
  const book = state.pet.stampBook;
  const { card, slots, full } = cardStatus(state, today);
  if (!card || !full) return book;   // 古い画面からの押下で、うまっていないカードを終わらせない
  const dates = slots.map((s) => s.date);
  const last = dates.at(-1);
  return {
    card: null,
    pressed: book.pressed.filter((d) => d > last),
    done: [...book.done, { ...card, dates, redeemedOn: today }],
  };
}

import { describe, it, expect } from 'vitest';
import {
  STAMP_DESIGNS, STAMP_INKS, designForDate, eligibleDates, cardStatus, pressStamp,
  saveCard, redeemCard, nextStartDate, clampCardSize, normalizeRewardEmoji, normalizeReward,
} from '../js/stamp-book.js';
import { normalizeState, mergeCloudInitial, mergeCloud } from '../js/storage.js';

const TODAY = '2026-11-16';
const s = (date, totalCount) => ({ date, songs: [{ name: 'きらきら', count: totalCount }], totalCount });
const card = (over = {}) => ({ id: 1, startDate: '2026-11-01', size: 5, reward: 'どうぶつえん', emoji: '🎡', ...over });
const st = (sessions, book = {}) => normalizeState({ sessions, pet: { stampBook: { card: card(), ...book } } });

describe('もらえる日の判定（#409）', () => {
  it('10回ちょうどで1こ・9回では付かない。1日に何回ひいても1こ', () => {
    const d = eligibleDates([s('2026-11-02', 9), s('2026-11-03', 10), s('2026-11-04', 40)], card(), TODAY);
    expect(d).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('同じ日が2件に分かれていても合計で判定する', () => {
    expect(eligibleDates([s('2026-11-02', 6), s('2026-11-02', 4)], card(), TODAY)).toEqual(['2026-11-02']);
  });

  it('開始日より前・今日より先は数えず、個数で打ち止め（古い順）', () => {
    const sessions = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-17']
      .map((d) => s(d, 10));
    expect(eligibleDates(sessions, card(), TODAY))
      .toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it('レッスン日は数えない（sessions に記録がない日）', () => {
    const state = normalizeState({ sessions: [], pet: { lessonDates: ['2026-11-03'], stampBook: { card: card() } } });
    expect(cardStatus(state, TODAY).slots).toEqual([]);
  });

  it('記録を直して10回を下回ればスタンプも消える（記録から導出）', () => {
    const pressed = { pressed: ['2026-11-03'] };
    expect(cardStatus(st([s('2026-11-03', 10)], pressed), TODAY).pressedCount).toBe(1);
    expect(cardStatus(st([s('2026-11-03', 8)], pressed), TODAY).pressedCount).toBe(0);
  });

  it('カードがなければ空', () => {
    const state = normalizeState({ sessions: [s('2026-11-03', 10)] });
    expect(cardStatus(state, TODAY)).toMatchObject({ card: null, slots: [], full: false });
  });
});

describe('押す・うまる（#409）', () => {
  const five = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => s(d, 10));

  it('押していない日は pending。全部押すと full', () => {
    let state = st(five);
    expect(cardStatus(state, TODAY)).toMatchObject({ pendingCount: 5, pressedCount: 0, full: false });
    for (const d of five.map((x) => x.date)) {
      state = { ...state, pet: { ...state.pet, stampBook: pressStamp(state.pet.stampBook, d) } };
    }
    expect(cardStatus(state, TODAY)).toMatchObject({ pendingCount: 0, pressedCount: 5, full: true });
  });

  it('個数に届いていなければ全部押しても full ではない', () => {
    const state = st(five.slice(0, 4), { pressed: five.slice(0, 4).map((x) => x.date) });
    expect(cardStatus(state, TODAY).full).toBe(false);
  });

  it('きょうの回数と、きょうのぶんが入ったかを返す', () => {
    expect(cardStatus(st([s(TODAY, 7)]), TODAY)).toMatchObject({ todayCount: 7, todayStamped: false });
    expect(cardStatus(st([s(TODAY, 12)]), TODAY)).toMatchObject({ todayCount: 12, todayStamped: true });
  });
});

describe('カードの作成・ごほうび・持ち越し（#409）', () => {
  it('はじめてのカードは今日から。設定は丸めて保存する', () => {
    const book = saveCard({ card: null, pressed: [], done: [] }, { reward: '  アイス  ', emoji: '❓', size: 99 }, TODAY, 123);
    expect(book.card).toEqual({ id: 123, startDate: TODAY, reward: 'アイス', emoji: '🎁', size: 60 });
  });

  it('いまのカードを直しても id・開始日は変わらない', () => {
    const book = saveCard({ card: card(), pressed: [], done: [] }, { reward: 'こうえん', emoji: '🧸', size: 3 }, TODAY, 999);
    expect(book.card).toEqual({ ...card(), reward: 'こうえん', emoji: '🧸', size: 5 });
  });

  it('ごほうびを あげると日付ごと固定され、うまった後の日は次のカードへ持ち越す', () => {
    const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-08'];
    const state = st(dates.map((d) => s(d, 10)), { pressed: dates });
    const book = redeemCard(state, TODAY);
    expect(book.card).toBeNull();
    expect(book.done).toEqual([{ ...card(), dates: dates.slice(0, 5), redeemedOn: TODAY }]);
    expect(book.pressed).toEqual(['2026-11-08']);                 // 持ち越し分の押印は残る
    expect(nextStartDate(book, TODAY)).toBe('2026-11-07');

    const next = saveCard(book, { reward: 'アイス', emoji: '🍦', size: 5 }, TODAY, 2);
    const after = { ...state, pet: { ...state.pet, stampBook: next } };
    expect(cardStatus(after, TODAY).slots.map((x) => [x.date, x.pressed])).toEqual([['2026-11-08', true]]);
  });

  it('うまっていないカードは「ごほうびを あげた」でも終わらない（古い画面からの押下）', () => {
    const state = st([s('2026-11-02', 10)], { pressed: ['2026-11-02'] });
    expect(redeemCard(state, TODAY)).toBe(state.pet.stampBook);
  });

  it('個数を減らすと、押した後ろの日は次のカードへ持ち越す（消えない）', () => {
    const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
    const state = st(dates.map((d) => s(d, 10)), { card: card({ size: 7 }), pressed: dates.slice(5) });
    expect(cardStatus(state, TODAY).pressedCount).toBe(2);
    const smaller = { ...state, pet: { ...state.pet, stampBook: { ...state.pet.stampBook, card: card({ size: 5 }) } } };
    expect(cardStatus(smaller, TODAY).pressedCount).toBe(0);    // 表示上は前の5日だけ
    let book = smaller.pet.stampBook;
    for (const d of dates.slice(0, 5)) book = pressStamp(book, d);
    const done = redeemCard({ ...smaller, pet: { ...smaller.pet, stampBook: book } }, TODAY);
    expect(done.pressed).toEqual(dates.slice(5));               // 押した2日は残り、次のカードで数える
    expect(nextStartDate(done, TODAY)).toBe('2026-11-07');
  });

  it('書式は正しいが実在しない日付（2026-11-00）は数えず、絵柄・次の開始日でも落ちない', () => {
    const state = st([s('2026-11-00', 10), s('2026-11-03', 10)], { pressed: ['2026-11-00'] });
    const status = cardStatus(state, TODAY);
    expect(status.slots.map((x) => x.date)).toEqual(['2026-11-03']);
    expect(designForDate('2026-11-00')).toBe(STAMP_DESIGNS[0]);
    const book = { card: null, pressed: [], done: [{ ...card(), dates: ['2026-11-03', '2026-13-01'], redeemedOn: TODAY }] };
    expect(nextStartDate(book, TODAY)).toBe('2026-11-04');
  });

  it('終わったカードは、後で記録を直しても崩れない', () => {
    const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const book = redeemCard(st(dates.map((d) => s(d, 10)), { pressed: dates }), TODAY);
    const edited = normalizeState({ sessions: [s('2026-11-02', 3)], pet: { stampBook: book } });
    expect(edited.pet.stampBook.done[0].dates).toEqual(dates);
  });
});

describe('絵柄（#409）', () => {
  it('16種・色は5色のどれか', () => {
    expect(STAMP_DESIGNS).toHaveLength(16);
    expect(new Set(STAMP_DESIGNS.map((d) => d.ink)).size).toBe(5);
    for (const d of STAMP_DESIGNS) expect(STAMP_INKS[d.ink]).toBeTruthy();
  });

  it('日付だけで決まり、16日のまとまりの中では同じ絵が出ない', () => {
    expect(designForDate('2026-11-03')).toBe(designForDate('2026-11-03'));
    const base = Date.UTC(2026, 0, 1) / 86400000;
    const start = Math.ceil(base / 16) * 16;
    const ids = Array.from({ length: 16 }, (_, i) => designForDate(new Date((start + i) * 86400000).toISOString().slice(0, 10)).id);
    expect(new Set(ids).size).toBe(16);
  });
});

describe('入力の丸め（#409）', () => {
  it('個数は5〜60・絵文字は候補外なら🎁・ごほうびは20文字', () => {
    expect([clampCardSize(1), clampCardSize(61), clampCardSize('abc'), clampCardSize(12.4)]).toEqual([5, 60, 10, 12]);
    expect(normalizeRewardEmoji('<b>')).toBe('🎁');
    expect(normalizeReward('あ'.repeat(30))).toHaveLength(20);
  });
});

describe('pet.stampBook の矯正とマージ（#409）', () => {
  it('壊れた値は既定へ。id・開始日の壊れたカードは捨てる', () => {
    expect(normalizeState({ pet: { stampBook: 'x' } }).pet.stampBook).toEqual({ card: null, pressed: [], done: [] });
    const b = normalizeState({ pet: { stampBook: {
      card: { id: 'abc', startDate: '2026-11-01' },
      pressed: ['2026-11-02', 'x', 3],
      done: [null, { id: 5, startDate: 'bad' }, { id: 6, startDate: '2026-10-01', size: 999, reward: 7, dates: 'y', redeemedOn: 1 }],
    } } }).pet.stampBook;
    expect(b.card).toBeNull();
    expect(b.pressed).toEqual(['2026-11-02']);
    expect(b.done).toEqual([{ id: 6, startDate: '2026-10-01', size: 60, reward: '7', emoji: '', dates: [], redeemedOn: null }]);
  });

  it('初回マージ：押した日・終わったカードは union、相手で終わったカードは復活しない', () => {
    const local = normalizeState({ pet: { stampBook: { card: card(), pressed: ['2026-11-02'] } } });
    const done = { ...card(), dates: ['2026-11-02'], redeemedOn: TODAY };
    const cloud = { pet: { stampBook: { card: card({ id: 2 }), pressed: ['2026-11-03'], done: [done] } } };
    const m = mergeCloudInitial(local, cloud).pet.stampBook;
    expect(m.card.id).toBe(2);
    expect(m.pressed).toEqual(['2026-11-02', '2026-11-03']);
    expect(m.done.map((x) => x.id)).toEqual([1]);
  });

  it('初回マージ：両方に別のカードがあれば新しく作った方', () => {
    const local = normalizeState({ pet: { stampBook: { card: card({ id: 9 }) } } });
    expect(mergeCloudInitial(local, { pet: { stampBook: { card: card({ id: 3 }) } } }).pet.stampBook.card.id).toBe(9);
    expect(mergeCloudInitial(normalizeState({}), { pet: { stampBook: { card: card({ id: 3 }) } } }).pet.stampBook.card.id).toBe(3);
  });

  it('realtime（cloud-wins）ではカードの変更がそのまま伝わる', () => {
    const local = normalizeState({ pet: { stampBook: { card: card() } } });
    expect(mergeCloud(local, { pet: { stampBook: { card: null, pressed: [], done: [] } } }).pet.stampBook.card).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { pickHappyVariant, catMarkup, tierFromBond, catImageSrc } from '../js/cat-image.js';

// 日常のお祝い演出のバリエーション選択（#81）。
// 描画・アニメ自体は CSS / DOM 依存なので、ここでは純粋な選択ロジックだけ検証する。
describe('pickHappyVariant', () => {
  const VARIANTS = ['', 'hop', 'spin'];

  it('返り値は必ず既知のバリエーションのいずれか', () => {
    for (let i = 0; i < 100; i++) {
      expect(VARIANTS).toContain(pickHappyVariant());
    }
  });

  it('rng の値に応じて決定的にバリエーションを選ぶ', () => {
    expect(pickHappyVariant(() => 0)).toBe('');     // floor(0 * 3) = 0
    expect(pickHappyVariant(() => 0.5)).toBe('hop'); // floor(1.5) = 1
    expect(pickHappyVariant(() => 0.99)).toBe('spin'); // floor(2.97) = 2
  });
});

// なつき度3段階(tier)：既存5なかよしレベル(#124)を集約する（新閾値を作らない）。
describe('tierFromBond', () => {
  it('なかよしレベル 1-2 は low、3-4 は mid、5 は high', () => {
    expect(tierFromBond(1)).toBe('low');
    expect(tierFromBond(2)).toBe('low');
    expect(tierFromBond(3)).toBe('mid');
    expect(tierFromBond(4)).toBe('mid');
    expect(tierFromBond(5)).toBe('high');
  });

  it('不正値は low にフォールバック', () => {
    expect(tierFromBond(0)).toBe('low');
    expect(tierFromBond(undefined)).toBe('low');
  });
});

// 画像セレクタ：tier×mood からファイルパスを決定的に組む。
describe('catImageSrc', () => {
  it('tier と mood からパスを組む', () => {
    expect(catImageSrc('mid', 'happy')).toBe('img/cat/cat_mid_happy.png');
    expect(catImageSrc('high', 'sleep')).toBe('img/cat/cat_high_sleep.png');
  });

  it('未知の tier / mood は low / idle にフォールバック', () => {
    expect(catImageSrc('bogus', 'happy')).toBe('img/cat/cat_low_happy.png');
    expect(catImageSrc('mid', 'bogus')).toBe('img/cat/cat_mid_idle.png');
  });
});

// なかよしエンブレム（#124）：bond レベルで猫の隅のハートしるしを出し分ける。
describe('catMarkup の なかよしエンブレム', () => {
  it('bond 未指定（0〜1）ではエンブレムを出さない', () => {
    expect(catMarkup()).not.toContain('cat__bond');
    expect(catMarkup({ bond: 1 })).not.toContain('cat__bond');
  });

  it('bond 2以上でハートのエンブレムが付く', () => {
    expect(catMarkup({ bond: 2 })).toContain('cat__bond');
  });

  it('bond 4以上できらきらが加わる', () => {
    expect(catMarkup({ bond: 3 })).not.toContain('cat__bond-sparkle');
    expect(catMarkup({ bond: 4 })).toContain('cat__bond-sparkle');
  });

  it('bond レベルから tier を導出して本体画像を選ぶ', () => {
    expect(catMarkup({ bond: 1 })).toContain('img/cat/cat_low_idle.png');
    expect(catMarkup({ bond: 5, mood: 'sleep' })).toContain('img/cat/cat_high_sleep.png');
  });
});

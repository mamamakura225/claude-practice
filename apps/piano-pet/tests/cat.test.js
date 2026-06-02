import { describe, it, expect } from 'vitest';
import { pickHappyVariant, catMarkup } from '../js/cat.js';

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
});

import { describe, it, expect } from 'vitest';
import { safeColor, contrastRatio, tint, readableTextColor, FALLBACK_COLOR } from '../utils/color.js';

const LIGHT = '#FFFFFF';
const DARK = '#1A1D27';

describe('safeColor', () => {
  it('#RRGGBB 以外は既定色に置き換える（style 属性への注入も防ぐ）', () => {
    expect(safeColor('#16A34A')).toBe('#16A34A');
    expect(safeColor('red')).toBe(FALLBACK_COLOR);
    expect(safeColor('#fff;background:url(x)')).toBe(FALLBACK_COLOR);
    expect(safeColor(undefined)).toBe(FALLBACK_COLOR);
  });
});

describe('contrastRatio', () => {
  it('白黒は 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
  });
});

describe('readableTextColor', () => {
  // 総点検で AA 未達だった色（緑 2.8・青 4.3）と、極端な色
  const colors = ['#16A34A', '#2563EB', '#CC0033', '#FACC15', '#FFFFFF', '#000000', '#22D3EE'];

  for (const surface of [LIGHT, DARK]) {
    it.each(colors)(`%s の文字は ${surface} 上のバッジ背景に対して 4.5:1 以上`, (c) => {
      const fg = readableTextColor(c, surface);
      expect(contrastRatio(fg, tint(c, surface, 0.13))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('既に十分な色はそのまま使う（色味を保つ）', () => {
    expect(readableTextColor('#1D4ED8', LIGHT)).toBe('#1d4ed8');
  });
});

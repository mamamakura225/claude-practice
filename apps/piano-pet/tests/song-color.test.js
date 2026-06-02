import { describe, it, expect } from 'vitest';
import { songHue, songColor } from '../js/song-color.js';

describe('songHue', () => {
  it('同じ曲名は常に同じ色相（決定的）', () => {
    expect(songHue('きらきらぼし')).toBe(songHue('きらきらぼし'));
  });

  it('前後の空白を無視して同一視する', () => {
    expect(songHue('  ちょうちょ  ')).toBe(songHue('ちょうちょ'));
  });

  it('違う曲名はだいたい違う色相になる', () => {
    const names = ['きらきらぼし', 'ちょうちょ', 'メリーさんのひつじ', 'かえるのうた', 'ぶんぶんぶん'];
    const hues = new Set(names.map(songHue));
    // 衝突しても3色以上は分かれてほしい（最低限の識別性）
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });

  it('色相は 0〜359 の範囲', () => {
    for (const name of ['a', '猫', 'ABCDEFG', '12345']) {
      const h = songHue(name);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('空文字・空白のみは null', () => {
    expect(songHue('')).toBeNull();
    expect(songHue('   ')).toBeNull();
    expect(songHue(null)).toBeNull();
    expect(songHue(undefined)).toBeNull();
  });
});

describe('songColor', () => {
  it('fill・tint・ink を返す', () => {
    const c = songColor('きらきらぼし');
    expect(c.fill).toMatch(/^hsl\(/);
    expect(c.tint).toMatch(/^hsl\(/);
    expect(c.ink).toMatch(/^hsl\(/);
    expect(c.hue).toBe(songHue('きらきらぼし'));
  });

  it('空名は無彩色（グレー）フォールバック', () => {
    const c = songColor('');
    expect(c.hue).toBeNull();
    expect(c.fill).toBe('#c9bcbf');
  });

  it('同じ曲名は同じ色セット', () => {
    expect(songColor('ちょうちょ')).toEqual(songColor('ちょうちょ'));
  });
});

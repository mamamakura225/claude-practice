import { describe, it, expect } from 'vitest';
import { songHue, songColor, shiftHue, assignSongColors } from '../js/song-color.js';

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

describe('shiftHue（衝突回避・#165）', () => {
  it('使用色相が空ならそのまま返す', () => {
    expect(shiftHue(120, [])).toBe(120);
  });

  it('近すぎる使用色相があれば離れた色相へずらす', () => {
    const used = [120];
    const got = shiftHue(120, used);
    expect(got).not.toBe(120);
    const dist = Math.min(Math.abs(got - 120), 360 - Math.abs(got - 120));
    expect(dist).toBeGreaterThanOrEqual(25);
  });

  it('色相環の境界（0/359）をまたぐ近接も衝突とみなす', () => {
    const got = shiftHue(5, [355]); // 環状距離は10
    const dist = Math.min(Math.abs(got - 355), 360 - Math.abs(got - 355));
    expect(dist).toBeGreaterThanOrEqual(25);
  });

  it('base が null（空名）なら null', () => {
    expect(shiftHue(null, [10, 20])).toBeNull();
  });
});

describe('assignSongColors（衝突回避つき一括割り当て・#165）', () => {
  it('各曲の色相が互いに十分離れる', () => {
    const names = ['きらきらぼし', 'ちょうちょ', 'メリーさんのひつじ', 'かえるのうた', 'ぶんぶんぶん'];
    const colors = assignSongColors(names);
    const hues = names.map((n) => colors.get(n).hue);
    for (let i = 0; i < hues.length; i += 1) {
      for (let j = i + 1; j < hues.length; j += 1) {
        const dist = Math.min(Math.abs(hues[i] - hues[j]), 360 - Math.abs(hues[i] - hues[j]));
        expect(dist).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('同じ並びなら結果は決定的', () => {
    const names = ['A', 'B', 'C'];
    expect(assignSongColors(names)).toEqual(assignSongColors(names));
  });

  it('重複・空名は1つに畳み込み無視する', () => {
    const colors = assignSongColors(['ねこ', 'ねこ', '', '  ', 'いぬ']);
    expect([...colors.keys()]).toEqual(['ねこ', 'いぬ']);
  });

  it('先頭の曲はハッシュどおりの色相（ずらさない）', () => {
    const colors = assignSongColors(['きらきらぼし', 'ちょうちょ']);
    expect(colors.get('きらきらぼし').hue).toBe(songHue('きらきらぼし'));
  });

  it('fill/tint/ink を含む色セットを返す', () => {
    const c = assignSongColors(['ねこ']).get('ねこ');
    expect(c.fill).toMatch(/^hsl\(/);
    expect(c.tint).toMatch(/^hsl\(/);
    expect(c.ink).toMatch(/^hsl\(/);
  });
});

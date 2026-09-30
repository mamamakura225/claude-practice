import { describe, it, expect } from 'vitest';
import { songHue, songColor, shiftHue, assignSongColors } from '../js/song-color.js';
import { songTotals } from '../js/record-form.js';

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

  // #326: 同じ sessions を別の並びで渡しても曲の色が一致する（songTotals の tie-break が
  // 配列位置に依存しないので、resync で sessions が並べ替わっても色が入れ替わらない）。
  it('同じ sessions を別の並びで渡しても曲の色が一致する（#326）', () => {
    // 「きらきらぼし」3回(8/20) と「ちょうちょ」3回(9/03)＝累計同数の tie。
    const sessions = [
      { date: '2026-08-20', songs: [{ name: 'きらきらぼし', count: 3 }] },
      { date: '2026-09-03', songs: [{ name: 'ちょうちょ', count: 3 }] },
    ];
    const colorsOf = (ss) => {
      const map = assignSongColors(songTotals(ss).map((t) => t.name));
      return [...map.entries()].map(([n, c]) => [n, c.hue]).sort();
    };
    expect(colorsOf([...sessions].reverse())).toEqual(colorsOf(sessions));
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

// 選択中の曲チップは tint の面に ink の文字（#359）。どの色相でも AA（4.5:1）を満たすこと。
// 旧実装（ink の明度 38%）は黄〜緑の色相で 3.35 まで落ちる。
describe('ink / tint のコントラスト（#359）', () => {
  const rgb = (hsl) => {
    const [h, s, l] = hsl.match(/[\d.]+/g).map(Number);
    const k = (n) => (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    return [0, 8, 4].map((n) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  };
  const lum = (c) => c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  it('全360色相で 4.5 以上', () => {
    const base = songColor('きらきらぼし');
    const at = (css, h) => css.replace(`hsl(${base.hue} `, `hsl(${h} `);
    let min = Infinity;
    for (let h = 0; h < 360; h += 1) min = Math.min(min, ratio(at(base.ink, h), at(base.tint, h)));
    expect(min).toBeGreaterThanOrEqual(4.5);
  });
});

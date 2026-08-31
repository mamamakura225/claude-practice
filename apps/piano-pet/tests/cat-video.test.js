import { describe, it, expect } from 'vitest';
import { CLIPS, pickClip } from '../js/cat-video.js';

// 再生（tryPlay / prime）は DOM・<video> 依存なので e2e（clip.spec.js）側で通す。
// ここは純粋なクリップ選択だけを検証する。
describe('pickClip（#227）', () => {
  it('CLIPS は3スタイルぶん定義されている', () => {
    expect(Object.keys(CLIPS).sort()).toEqual(['russianblue', 'shiro', 'tora']);
    for (const pool of Object.values(CLIPS)) {
      expect(Array.isArray(pool)).toBe(true);
      expect(pool.length).toBeGreaterThan(0);
      for (const clip of pool) {
        expect(typeof clip.id).toBe('string');
        expect(clip.src).toMatch(/\.mp4$/);
      }
    }
  });

  it('指定スタイルのクリップを返す（スタイル一致）', () => {
    expect(pickClip('shiro', () => 0).src).toContain('shiro');
    expect(pickClip('russianblue', () => 0).src).toContain('russianblue');
    expect(pickClip('tora', () => 0).src).toContain('tora');
  });

  it('未知スタイルは tora にフォールバックする', () => {
    expect(pickClip('ぐれー', () => 0).src).toContain('tora');
    expect(pickClip(undefined, () => 0).src).toContain('tora');
    expect(pickClip('', () => 0.99).src).toContain('tora');
  });

  it('rng は決定的に使われる（プールの範囲内を選ぶ）', () => {
    const pool = CLIPS.tora;
    expect(pickClip('tora', () => 0)).toBe(pool[0]);
    expect(pickClip('tora', () => 0.999)).toBe(pool[pool.length - 1]);
  });
});

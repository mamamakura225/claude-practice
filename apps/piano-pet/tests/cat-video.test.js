import { describe, it, expect, beforeEach } from 'vitest';
import { CLIPS, pickClip, peekClip, resetClipBags } from '../js/cat-video.js';

// 再生（tryPlay / prime）は DOM・<video> 依存なので e2e（clip.spec.js）側で通す。
// ここは純粋なクリップ選択だけを検証する。

/** 指定した値を順に返す rng。使い切ったら最後の値を返し続ける。 */
const seq = (...values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe('pickClip（#227・#300）', () => {
  beforeEach(() => resetClipBags());   // バッグはモジュールレベルの状態なのでテスト間で畳む

  it('CLIPS は3スタイル×3本ぶん定義されている', () => {
    expect(Object.keys(CLIPS).sort()).toEqual(['russianblue', 'shiro', 'tora']);
    for (const pool of Object.values(CLIPS)) {
      expect(pool).toHaveLength(3);
      expect(pool.map((c) => c.id)).toEqual(['record_v1', 'record_v2', 'record_v3']);
      for (const clip of pool) {
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

  it('未知スタイルは tora と同じバッグを共有する（先読みと実再生がズレない）', () => {
    expect(peekClip('ぐれー')).toBe(peekClip('tora'));
    const served = pickClip('ぐれー');
    expect(peekClip('tora')).not.toBe(served);   // tora 側のバッグが進んでいる
  });

  it('1バッグ引き切ると全3本がちょうど1回ずつ出る', () => {
    const drawn = [pickClip('tora', () => 0), pickClip('tora', () => 0), pickClip('tora', () => 0)];
    expect(new Set(drawn).size).toBe(3);
    expect(new Set(drawn)).toEqual(new Set(CLIPS.tora));
  });

  it('バッグの境目でも直前と同じクリップが連続しない', () => {
    // 1バッグ目は [v1,v2,v3] のまま（0.999 は Fisher-Yates が自分自身と入れ替わる値）。
    // 2バッグ目は素の shuffle だと [v3,v2,v1] になり、境目で v3 が連続してしまう並び。
    const rng = seq(0.999, 0.999, 0, 0.9);
    const drawn = Array.from({ length: 6 }, () => pickClip('tora', rng));
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]).not.toBe(drawn[i - 1]);
    }
    expect(drawn.map((c) => c.id)).toEqual([
      'record_v1', 'record_v2', 'record_v3',
      'record_v1', 'record_v2', 'record_v3',
    ]);
  });

  it('peekClip は消費せず、直後の pickClip と一致する', () => {
    const peeked = peekClip('shiro');
    expect(peekClip('shiro')).toBe(peeked);      // 何度覗いても進まない
    expect(pickClip('shiro')).toBe(peeked);      // prime が先読みした1本がそのまま再生される
    expect(peekClip('shiro')).not.toBe(peeked);  // 引いた後は次の1本を指す
  });

  it('スタイルごとに独立したバッグを持つ', () => {
    const toraFirst = pickClip('tora', () => 0);
    expect(pickClip('shiro', () => 0).src).toContain('shiro');
    expect(pickClip('tora', () => 0)).not.toBe(toraFirst);
  });
});

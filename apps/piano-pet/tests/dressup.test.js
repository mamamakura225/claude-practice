import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableDressup } from '../js/dressup.js';
import { normalizeState } from '../js/storage.js';

// きせかえのポインタ処理（#428）。DOM は使う分だけの偽物で足りる。
const listeners = {};
const target = {
  addEventListener: (type, fn) => { listeners[type] = fn; },
  removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
};
const item = {
  dataset: { item: 'crown', scale: '0.9' },
  classList: { add() {}, remove() {} },
  closest: () => item,
  setAttribute() {},
};
const stage = {
  ...target,
  contains: () => true,
  querySelector: () => ({ dataset: { style: 'tora' } }),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
};
const fire = (type, pointerId, clientX = 100, clientY = 100) =>
  listeners[type]?.({ pointerId, clientX, clientY, target: item, preventDefault() {} });

describe('enableDressup のポインタ処理', () => {
  let onCommit;
  let disable;
  beforeEach(() => {
    vi.stubGlobal('window', target);
    onCommit = vi.fn();
    disable = enableDressup(stage, () => ({}), onCommit);
  });
  afterEach(() => { disable(); vi.unstubAllGlobals(); });

  it('pointercancel で掴みが終わり、次の1本指ドラッグがピンチにならない', () => {
    fire('pointerdown', 1);
    fire('pointermove', 1, 120, 100);
    fire('pointercancel', 1);
    expect(onCommit).toHaveBeenCalledTimes(1);

    fire('pointerdown', 2);
    fire('pointermove', 2, 40, 60);
    fire('pointerup', 2, 40, 60);
    expect(onCommit).toHaveBeenLastCalledWith({ crown: { x_pct: 20, y_pct: 30 } });   // 位置だけ動き scale は付かない
  });

  it('掴んだ指を離して置き直しても throw せず、触れている2本でピンチできる', () => {
    fire('pointerdown', 1, 100, 100);
    fire('pointerdown', 2, 150, 100);
    fire('pointerup', 1);
    expect(() => fire('pointerdown', 3, 100, 100)).not.toThrow();
    fire('pointermove', 3, 80, 100);    // デッドゾーン通過（基準 70px）
    fire('pointermove', 3, 10, 100);    // 140px＝2倍
    fire('pointerup', 3);
    fire('pointerup', 2);
    expect(onCommit.mock.calls[0][0].crown.scale).toBeCloseTo(1.8);
  });

  it('落としたエントリのキー順は入口の矯正（normalizeItemLayout）と同じ', () => {
    disable();
    disable = enableDressup(stage, () => ({ crown: { layer: 'back' } }), onCommit);
    item.dataset.scale = '1.5';
    fire('pointerdown', 1);
    fire('pointermove', 1, 40, 60);
    fire('pointerup', 1);
    item.dataset.scale = '0.9';
    const layout = onCommit.mock.calls[0][0];
    expect(JSON.stringify(normalizeState({ pet: { itemLayout: layout } }).pet.itemLayout)).toBe(JSON.stringify(layout));
  });

  it('解除するとリスナーが残らない', () => {
    disable();
    expect(listeners).toEqual({});
  });
});

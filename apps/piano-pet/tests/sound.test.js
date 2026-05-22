import { describe, it, expect } from 'vitest';
import { isSoundOn, toggleSound, SOUND_SPECS } from '../js/sound.js';

describe('isSoundOn', () => {
  it('未設定はデフォルトON扱い', () => {
    expect(isSoundOn({})).toBe(true);
    expect(isSoundOn({ settings: {} })).toBe(true);
  });

  it('soundOn:false のときだけOFF', () => {
    expect(isSoundOn({ settings: { soundOn: false } })).toBe(false);
    expect(isSoundOn({ settings: { soundOn: true } })).toBe(true);
  });
});

describe('toggleSound', () => {
  it('ON↔OFF を反転する', () => {
    const off = toggleSound({ settings: { soundOn: true } });
    expect(off.settings.soundOn).toBe(false);
    const on = toggleSound(off);
    expect(on.settings.soundOn).toBe(true);
  });

  it('未設定からは OFF になる（デフォルトONを反転）', () => {
    expect(toggleSound({}).settings.soundOn).toBe(false);
  });

  it('他のstateや既存settingsを保持する', () => {
    const state = { pet: { coins: 5 }, settings: { soundOn: true, foo: 1 } };
    const next = toggleSound(state);
    expect(next.pet).toBe(state.pet);
    expect(next.settings.foo).toBe(1);
  });

  it('元の state を破壊しない', () => {
    const state = { settings: { soundOn: true } };
    toggleSound(state);
    expect(state.settings.soundOn).toBe(true);
  });
});

describe('SOUND_SPECS', () => {
  it('必要な効果音が定義されている', () => {
    for (const name of ['coin', 'levelup', 'record', 'purchase']) {
      expect(Array.isArray(SOUND_SPECS[name])).toBe(true);
      expect(SOUND_SPECS[name].length).toBeGreaterThan(0);
    }
  });

  it('各音符が周波数とタイミングを持つ', () => {
    for (const notes of Object.values(SOUND_SPECS)) {
      for (const n of notes) {
        expect(n.f).toBeGreaterThan(0);
        expect(n.d).toBeGreaterThan(0);
        expect(n.t).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

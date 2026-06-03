import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSoundOn,
  toggleSound,
  SOUND_SPECS,
  MEOW_SOUNDS,
  HISS_SOUNDS,
  rollCatVoice,
  STAMP_BASE_FREQ,
  stampSemitone,
  stampFrequency,
} from '../js/sound.js';

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

describe('stampSemitone / stampFrequency (#139)', () => {
  it('1マス目はド（半音0）＝基準周波数', () => {
    expect(stampSemitone(0, 10)).toBe(0);
    expect(stampFrequency(0, 10)).toBeCloseTo(STAMP_BASE_FREQ, 5);
  });

  it('ドレミファソラシ＝メジャー音階で上がる', () => {
    const expected = [0, 2, 4, 5, 7, 9, 11]; // ド レ ミ ファ ソ ラ シ
    expected.forEach((semi, i) => {
      expect(stampSemitone(i, 10)).toBe(semi);
    });
  });

  it('目標マス（最後の1マス）は高いド＝オクターブ(+12)に解決する', () => {
    expect(stampSemitone(9, 10)).toBe(12);
    expect(stampFrequency(9, 10)).toBeCloseTo(STAMP_BASE_FREQ * 2, 5);
  });

  it('オクターブ上がると周波数は2倍（平均律）', () => {
    // ド↑（index7 = MAJOR[0] + 12）はちょうど基準の2倍
    expect(stampSemitone(7, 10)).toBe(12);
    expect(stampFrequency(7, 10)).toBeCloseTo(STAMP_BASE_FREQ * 2, 5);
  });

  it('goal が変わっても最後のマスがオクターブで締まる', () => {
    expect(stampSemitone(4, 5)).toBe(12);
    expect(stampSemitone(0, 5)).toBe(0);
  });

  it('不正な index は0扱い（ガード）', () => {
    expect(stampSemitone(-1, 10)).toBe(0);
    expect(stampSemitone(NaN, 10)).toBe(0);
  });
});

describe('rollCatVoice', () => {
  afterEach(() => vi.restoreAllMocks());

  // 抽選は音設定・環境に依存しない純粋関数（再生から分離 → ミュート時も威嚇抑制が効く）
  it('HISS_CHANCE(0.15) 未満なら hiss、以上なら meow', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(rollCatVoice()).toBe('hiss');
    vi.spyOn(Math, 'random').mockReturnValue(0.14);
    expect(rollCatVoice()).toBe('hiss');
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    expect(rollCatVoice()).toBe('meow');
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(rollCatVoice()).toBe('meow');
  });

  it('state を受け取らず、引数なしで種類だけ返す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(rollCatVoice()).toBe('meow');
  });
});

describe('MEOW_SOUNDS / HISS_SOUNDS', () => {
  it('鳴き声サンプルが3種以上、威嚇サンプルが1種以上ある', () => {
    expect(Array.isArray(MEOW_SOUNDS)).toBe(true);
    expect(MEOW_SOUNDS.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(HISS_SOUNDS)).toBe(true);
    expect(HISS_SOUNDS.length).toBeGreaterThanOrEqual(1);
  });

  it('各サンプルが sounds 配下の mp3 を指す', () => {
    for (const url of [...MEOW_SOUNDS, ...HISS_SOUNDS]) {
      expect(url).toMatch(/sounds\/.+\.mp3$/);
    }
  });
});

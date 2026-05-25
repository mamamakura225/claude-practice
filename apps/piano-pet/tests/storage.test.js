import { describe, it, expect } from 'vitest';
import {
  normalizeState,
  cloudFields,
  mergeCloud,
  migrate,
  CLOUD_FIELDS,
  SCHEMA_VERSION,
} from '../js/storage.js';

describe('normalizeState', () => {
  it('空入力で DEFAULTS を返す', () => {
    const s = normalizeState();
    expect(s.pet).toEqual({ name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], affinity: 0, foodSpent: 0 });
    expect(s.inventory).toEqual([]);
    expect(s.streak).toEqual({ current: 0, best: 0, lastPracticeDate: null, freezes: 0 });
    expect(s.badges).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.settings).toEqual({ soundOn: true });
  });

  it('ネストした既存値を保持しつつ不足キーを補完する', () => {
    const s = normalizeState({ pet: { coins: 50 }, streak: { current: 3 } });
    expect(s.pet.coins).toBe(50);
    expect(s.pet.level).toBe(1);          // 補完
    expect(s.streak.current).toBe(3);
    expect(s.streak.freezes).toBe(0);     // 補完
    expect(s.settings.soundOn).toBe(true);
  });

  it('トップレベルの未知キーは引き継ぐ', () => {
    const s = normalizeState({ sessions: [{ date: '2026-01-01' }] });
    expect(s.sessions).toHaveLength(1);
  });

  it('version を現行スキーマバージョンに揃える', () => {
    expect(normalizeState().version).toBe(SCHEMA_VERSION);
  });
});

describe('migrate', () => {
  it('version を持たないレガシーデータを現行バージョンに引き上げる', () => {
    const legacy = { pet: { coins: 50 }, sessions: [{ date: '2026-01-01' }] };
    const m = migrate(legacy);
    expect(m.version).toBe(SCHEMA_VERSION);
    expect(m.pet.coins).toBe(50);          // データは保持
    expect(m.sessions).toHaveLength(1);
  });

  it('現行バージョンのデータはそのまま (冪等)', () => {
    const current = { version: SCHEMA_VERSION, pet: { coins: 7 } };
    const m = migrate(current);
    expect(m).toEqual(current);
  });

  it('空/未定義入力でも version 付きオブジェクトを返す', () => {
    expect(migrate().version).toBe(SCHEMA_VERSION);
    expect(migrate(null).version).toBe(SCHEMA_VERSION);
  });

  it('現行より新しいデータはバージョンを下げない (ダウングレード保護)', () => {
    const future = { version: SCHEMA_VERSION + 5, pet: { coins: 1 } };
    const m = migrate(future);
    expect(m.version).toBe(SCHEMA_VERSION + 5);
    expect(m.pet.coins).toBe(1);
  });
});

describe('cloudFields', () => {
  it('CLOUD_FIELDS のみを抜き出し settings は含めない', () => {
    const state = normalizeState({ pet: { coins: 10 }, settings: { soundOn: false } });
    const picked = cloudFields(state);
    expect(Object.keys(picked).sort()).toEqual([...CLOUD_FIELDS].sort());
    expect(picked).not.toHaveProperty('settings');
    expect(picked.pet.coins).toBe(10);
  });
});

describe('mergeCloud', () => {
  it('クラウドのデータフィールドをローカルに重ねる', () => {
    const local = normalizeState({ pet: { coins: 5 } });
    const merged = mergeCloud(local, { pet: { coins: 99, level: 3 }, sessions: [{ date: 'x' }] });
    expect(merged.pet.coins).toBe(99);
    expect(merged.pet.level).toBe(3);
    expect(merged.sessions).toHaveLength(1);
  });

  it('端末ローカル設定(settings)はクラウドに無いので保持される', () => {
    const local = normalizeState({ settings: { soundOn: false }, pet: { coins: 1 } });
    const merged = mergeCloud(local, { pet: { coins: 7 } });
    expect(merged.settings.soundOn).toBe(false);   // 上書きされない
    expect(merged.pet.coins).toBe(7);
  });

  it('クラウドが空/欠損でもローカルを壊さない', () => {
    const local = normalizeState({ pet: { coins: 42 }, sessions: [{ date: 'a' }] });
    const merged = mergeCloud(local, null);
    expect(merged.pet.coins).toBe(42);
    expect(merged.sessions).toHaveLength(1);
  });
});

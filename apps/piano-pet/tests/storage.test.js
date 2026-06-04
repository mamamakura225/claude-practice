import { describe, it, expect } from 'vitest';
import {
  normalizeState,
  cloudFields,
  mergeCloud,
  mergeSessionsKeepLarger,
  mergeCloudInitial,
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

describe('mergeSessionsKeepLarger', () => {
  it('片側のみの日付は両方残す', () => {
    const local = [{ date: '2026-01-02', totalCount: 5 }];
    const cloud = [{ date: '2026-01-01', totalCount: 3 }];
    const m = mergeSessionsKeepLarger(local, cloud);
    expect(m.map((s) => s.date)).toEqual(['2026-01-02', '2026-01-01']); // 降順
  });

  it('同日衝突は totalCount の大きい方を採用（合算しない）', () => {
    const local = [{ date: '2026-01-01', totalCount: 5, songs: ['X'] }];
    const cloud = [{ date: '2026-01-01', totalCount: 7, songs: ['X', 'X'] }];
    const m = mergeSessionsKeepLarger(local, cloud);
    expect(m).toHaveLength(1);
    expect(m[0].totalCount).toBe(7);           // 12 にはしない（水増し防止）
    expect(m[0].songs).toEqual(['X', 'X']);
  });

  it('同回数の tie はローカルを残す（自分の書き込みのエコー等）', () => {
    const local = [{ date: '2026-01-01', totalCount: 5, songs: ['L'] }];
    const cloud = [{ date: '2026-01-01', totalCount: 5, songs: ['C'] }];
    const m = mergeSessionsKeepLarger(local, cloud);
    expect(m[0].songs).toEqual(['L']);
  });

  it('起動直後にローカルだけが持つ当日記録を失わない（clobber 防止）', () => {
    const cloud = [{ date: '2026-01-01', totalCount: 4 }];
    const local = [{ date: '2026-01-02', totalCount: 6 }, { date: '2026-01-01', totalCount: 4 }];
    const m = mergeSessionsKeepLarger(local, cloud);
    expect(m.map((s) => s.date)).toEqual(['2026-01-02', '2026-01-01']);
  });

  it('null/欠損入力でも壊れない', () => {
    expect(mergeSessionsKeepLarger(null, null)).toEqual([]);
    expect(mergeSessionsKeepLarger([{ totalCount: 1 }], null)).toEqual([]); // date 無しは捨てる
  });
});

describe('mergeCloudInitial', () => {
  it('cloud が無ければ正規化したローカルをそのまま返す', () => {
    const local = normalizeState({ pet: { coins: 9 }, sessions: [{ date: 'a', totalCount: 1 }] });
    const m = mergeCloudInitial(local, null);
    expect(m.pet.coins).toBe(9);
    expect(m.sessions).toHaveLength(1);
  });

  it('sessions は keep-larger、inventory は重複除く union', () => {
    const local = normalizeState({
      inventory: ['ribbon', 'hat'],
      sessions: [{ date: '2026-01-02', totalCount: 6 }],
    });
    const cloud = {
      inventory: ['ribbon', 'crown'],
      sessions: [{ date: '2026-01-01', totalCount: 3 }, { date: '2026-01-02', totalCount: 4 }],
    };
    const m = mergeCloudInitial(local, cloud);
    expect([...m.inventory].sort()).toEqual(['crown', 'hat', 'ribbon']);
    expect(m.sessions.find((s) => s.date === '2026-01-02').totalCount).toBe(6); // local 優先（大）
    expect(m.sessions.map((s) => s.date)).toEqual(['2026-01-02', '2026-01-01']);
  });

  it('equippedItems は union のうちマージ後 inventory に含まれるものだけ', () => {
    const local = normalizeState({ inventory: ['ribbon'], pet: { equippedItems: ['ribbon'] } });
    const cloud = { inventory: ['hat'], pet: { equippedItems: ['hat', 'crown'] } }; // crown は誰も所持しない
    const m = mergeCloudInitial(local, cloud);
    expect([...m.pet.equippedItems].sort()).toEqual(['hat', 'ribbon']); // crown は除外
  });

  it('affinity / foodSpent は max を採る', () => {
    const local = normalizeState({ pet: { affinity: 8, foodSpent: 30 } });
    const cloud = { pet: { affinity: 3, foodSpent: 55 } };
    const m = mergeCloudInitial(local, cloud);
    expect(m.pet.affinity).toBe(8);
    expect(m.pet.foodSpent).toBe(55);
  });
});

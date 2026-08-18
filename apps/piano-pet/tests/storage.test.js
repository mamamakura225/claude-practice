import { describe, it, expect } from 'vitest';
import { mergeSameDaySessions, recomputeState } from '../js/game.js';
import { spentCoins } from '../js/shop.js';
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
    expect(s.pet).toEqual({ name: 'きーちゃん', level: 1, xp: 0, coins: 0, equippedItems: [], placedItems: [], itemLayout: {}, affinity: 0, foodSpent: 0, dailyGoal: 10, catStyle: 'tora', childName: '', childAvatar: 'chick' });
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

  it('itemLayout が無ければ空オブジェクトで補完する（#168）', () => {
    expect(normalizeState().pet.itemLayout).toEqual({});
    const s = normalizeState({ pet: { itemLayout: { crown: { x_pct: 50, y_pct: 20 } } } });
    expect(s.pet.itemLayout).toEqual({ crown: { x_pct: 50, y_pct: 20 } });
  });
});

// クラウド doc（認証なし・#258）や取り込んだバックアップ JSON は信頼できない入力であり、
// normalizeState がアプリ内で唯一の入口ガードになる。型不正がここを通ると app.js の
// モジュールトップで throw して**アプリ全体が起動不能**になり、壊れた値は localStorage に
// 残るためリロードでも復旧しない（#272）。
describe('normalizeState の型矯正（#272）', () => {
  it('配列であるべきフィールドが配列でなければ既定（空配列）へ倒す', () => {
    const s = normalizeState({
      sessions: { a: 1 },
      inventory: 'ribbon',
      badges: 42,
      pet: { equippedItems: null, placedItems: 'cushion' },
    });
    expect(s.sessions).toEqual([]);
    expect(s.inventory).toEqual([]);
    expect(s.badges).toEqual([]);
    expect(s.pet.equippedItems).toEqual([]);
    expect(s.pet.placedItems).toEqual([]);
  });

  it('sessions の null / 非オブジェクト要素を落とす（配列であることだけでは足りない）', () => {
    const s = normalizeState({ sessions: [null, 'x', 5, { date: '2026-01-01', totalCount: 3 }] });
    expect(s.sessions).toEqual([{ date: '2026-01-01', totalCount: 3 }]);
  });

  it('pet / streak / settings / itemLayout が非オブジェクトでも既定へ倒す', () => {
    const s = normalizeState({ pet: 'x', streak: [1, 2], settings: 7 });
    expect(s.pet.coins).toBe(0);
    expect(s.pet.itemLayout).toEqual({});
    expect(s.streak.current).toBe(0);
    expect(s.settings.soundOn).toBe(true);
    expect(normalizeState({ pet: { itemLayout: null } }).pet.itemLayout).toEqual({});
  });

  it('state 自体が配列・プリミティブでも DEFAULTS を返す', () => {
    expect(normalizeState([1, 2, 3]).sessions).toEqual([]);
    expect(normalizeState('broken').pet.coins).toBe(0);
  });

  it('型不正な state を通しても起動経路（mergeSameDaySessions / recomputeState）が落ちない', () => {
    const broken = normalizeState({ sessions: { a: 1 }, inventory: 'ribbon', pet: { coins: 'x' } });
    expect(() => mergeSameDaySessions(broken.sessions)).not.toThrow();
    expect(() => recomputeState(broken, spentCoins(broken))).not.toThrow();
  });

  it('クラウド由来の壊れたデータを取り込んでも state は健全なまま（mergeCloud 経路）', () => {
    const local = normalizeState({ sessions: [{ date: '2026-01-01', totalCount: 3 }] });
    const merged = mergeCloud(local, { sessions: 'wiped', inventory: { a: 1 } });
    expect(merged.sessions).toEqual([]);
    expect(merged.inventory).toEqual([]);
    expect(() => mergeSameDaySessions(merged.sessions)).not.toThrow();
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

  it('現行バージョンは 2 で、v0→v1→v2 は構造を変えない（バージョン差の固定）', () => {
    // SCHEMA_VERSION シンボルだけで書くと、将来 MIGRATIONS に実処理を足しても
    // 既存テストは通ったまま素通りする。実際の番号と「何もしない」ことを固定しておく。
    expect(SCHEMA_VERSION).toBe(2);
    const legacy = { pet: { coins: 3 }, sessions: [{ date: '2026-01-01', totalCount: 1 }], inventory: ['ribbon'] };
    const m = migrate(legacy);
    expect(m).toEqual({ ...legacy, version: 2 });   // version 付与以外の差分が無い
    // v1 のデータ（itemLayout 導入前）も構造は変えず版だけ上がる
    const v1 = { version: 1, pet: { coins: 3 }, sessions: [] };
    expect(migrate(v1)).toEqual({ ...v1, version: 2 });
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

  it('衝突時 bonusCoins は双方の max を救済する（おまけ消失防止 #148）', () => {
    // 練習量は cloud(5)が多いが、おまけ当選は local(3) 側だけ → 両方残す
    const local = [{ date: '2026-01-01', totalCount: 3, bonusCoins: 3 }];
    const cloud = [{ date: '2026-01-01', totalCount: 5, bonusCoins: 0 }];
    const m = mergeSessionsKeepLarger(local, cloud);
    expect(m[0].totalCount).toBe(5);   // 練習量の多い方を採用
    expect(m[0].bonusCoins).toBe(3);   // おまけは消さない
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

  it('placedItems も union のうちマージ後 inventory に含まれるものだけ（#226）', () => {
    const local = normalizeState({ inventory: ['cushion'], pet: { placedItems: ['cushion'] } });
    const cloud = { inventory: ['yarnBall'], pet: { placedItems: ['yarnBall', 'crown'] } }; // crown は誰も所持しない
    const m = mergeCloudInitial(local, cloud);
    expect([...m.pet.placedItems].sort()).toEqual(['cushion', 'yarnBall']); // crown は除外
  });

  it('affinity / foodSpent は max を採る', () => {
    const local = normalizeState({ pet: { affinity: 8, foodSpent: 30 } });
    const cloud = { pet: { affinity: 3, foodSpent: 55 } };
    const m = mergeCloudInitial(local, cloud);
    expect(m.pet.affinity).toBe(8);
    expect(m.pet.foodSpent).toBe(55);
  });

  it('itemLayout は union（cloud を土台にローカル上書き）で他端末の配置座標を消さない（#242）', () => {
    // 端末B（サスペンド復帰直後の古い state）に、端末A がクラウドで置いた yarnBall の座標が無い状況。
    const local = normalizeState({
      inventory: ['cushion', 'yarnBall'],
      pet: { placedItems: ['cushion'], itemLayout: { cushion: { x_pct: 40, y_pct: 60 } } },
    });
    const cloud = {
      inventory: ['cushion', 'yarnBall'],
      pet: { placedItems: ['yarnBall'], itemLayout: { yarnBall: { x_pct: 70, y_pct: 55 }, cushion: { x_pct: 10, y_pct: 10 } } },
    };
    const m = mergeCloudInitial(local, cloud);
    expect([...m.pet.placedItems].sort()).toEqual(['cushion', 'yarnBall']); // A の置物が消えない
    expect(m.pet.itemLayout.yarnBall).toEqual({ x_pct: 70, y_pct: 55 });    // A の座標を取り込む
    expect(m.pet.itemLayout.cushion).toEqual({ x_pct: 40, y_pct: 60 });     // 競合はローカル優先
  });
});

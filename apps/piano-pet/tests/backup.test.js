import { describe, it, expect } from 'vitest';
import {
  exportState,
  backupFilename,
  parseBackup,
  importErrorMessage,
  makeGateProblem,
  RESTORE_BACKUP_KEY,
} from '../js/backup.js';
import { normalizeState, SCHEMA_VERSION } from '../js/storage.js';

describe('exportState', () => {
  it('app マーカー・schemaVersion・exportedAt・state を含む JSON を返す', () => {
    const state = normalizeState({ pet: { coins: 30 } });
    const json = exportState(state, new Date('2026-06-04T12:00:00Z'));
    const obj = JSON.parse(json);
    expect(obj.app).toBe('piano-pet');
    expect(obj.schemaVersion).toBe(SCHEMA_VERSION);
    expect(obj.exportedAt).toBe('2026-06-04T12:00:00.000Z');
    expect(obj.state.pet.coins).toBe(30);
  });

  it('pretty JSON（インデントあり）で書き出す', () => {
    const json = exportState(normalizeState(), new Date());
    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });

  it('がぞくコードを渡すと同梱し、未移行(null)なら含めない（#233）', () => {
    const withCode = JSON.parse(exportState(normalizeState(), new Date(), 'pp-abcdef0123456789'));
    expect(withCode.cloudDocId).toBe('pp-abcdef0123456789');
    const without = JSON.parse(exportState(normalizeState(), new Date()));
    expect('cloudDocId' in without).toBe(false);
  });
});

describe('backupFilename', () => {
  it('piano-pet-backup-YYYY-MM-DD.json 形式', () => {
    expect(backupFilename(new Date(2026, 5, 4))).toBe('piano-pet-backup-2026-06-04.json');
    expect(backupFilename(new Date(2026, 0, 9))).toBe('piano-pet-backup-2026-01-09.json');
  });
});

describe('parseBackup', () => {
  const validJson = () => exportState(normalizeState({ pet: { coins: 7 }, sessions: [{ date: '2026-01-01', totalCount: 3 }] }), new Date());

  it('正しいバックアップを取り込み、normalize 済み state を返す', () => {
    const res = parseBackup(validJson());
    expect(res.ok).toBe(true);
    expect(res.state.pet.coins).toBe(7);
    expect(res.state.sessions).toHaveLength(1);
    expect(res.state.settings.soundOn).toBe(true); // normalize で補完
    expect(res.state.version).toBe(SCHEMA_VERSION);
  });

  it('がぞくコードを取り出す。不正な形式・未同梱は null（#233）', () => {
    const good = parseBackup(exportState(normalizeState(), new Date(), 'pp-abcdef0123456789'));
    expect(good.cloudDocId).toBe('pp-abcdef0123456789');
    expect(parseBackup(validJson()).cloudDocId).toBeNull();          // 未同梱
    const bad = JSON.parse(validJson());
    bad.cloudDocId = 'bad id';
    expect(parseBackup(JSON.stringify(bad)).cloudDocId).toBeNull();  // 不正形式は無視
  });

  it('JSON が壊れていれば reason=parse', () => {
    expect(parseBackup('{ broken')).toEqual({ ok: false, reason: 'parse' });
  });

  it('app マーカーが無い/違うなら reason=marker', () => {
    expect(parseBackup(JSON.stringify({ state: { pet: {}, streak: {} } })).reason).toBe('marker');
    expect(parseBackup(JSON.stringify({ app: 'dtask', state: { pet: {}, streak: {} } })).reason).toBe('marker');
  });

  it('必須キー（pet/streak）が欠けていれば reason=shape', () => {
    expect(parseBackup(JSON.stringify({ app: 'piano-pet', state: { pet: {} } })).reason).toBe('shape');
    expect(parseBackup(JSON.stringify({ app: 'piano-pet', state: null })).reason).toBe('shape');
    expect(parseBackup(JSON.stringify({ app: 'piano-pet' })).reason).toBe('shape');
  });

  it('配列であるべきフィールドが壊れていれば reason=shape で弾く（#272）', () => {
    const withState = (state) => JSON.stringify({ app: 'piano-pet', schemaVersion: 1, state });
    const base = { pet: {}, streak: {} };
    expect(parseBackup(withState({ ...base, sessions: { a: 1 } })).reason).toBe('shape');
    expect(parseBackup(withState({ ...base, inventory: 'ribbon' })).reason).toBe('shape');
    expect(parseBackup(withState({ ...base, badges: 42 })).reason).toBe('shape');
    // pet / streak が配列でも「オブジェクト」として通してはいけない
    expect(parseBackup(withState({ pet: [], streak: {} })).reason).toBe('shape');
    // 未指定は従来どおり許容（レガシー寛容・normalizeState が補完する）
    expect(parseBackup(withState(base)).ok).toBe(true);
  });

  it('現行より新しいスキーマ版は reason=future で拒否', () => {
    const future = JSON.stringify({
      app: 'piano-pet',
      schemaVersion: SCHEMA_VERSION + 1,
      state: { pet: {}, streak: {} },
    });
    expect(parseBackup(future).reason).toBe('future');
  });

  it('schemaVersion 無しでも pet/streak があれば取り込める（レガシー寛容）', () => {
    const res = parseBackup(JSON.stringify({ app: 'piano-pet', state: { pet: { coins: 1 }, streak: { current: 2 } } }));
    expect(res.ok).toBe(true);
    expect(res.state.pet.coins).toBe(1);
    expect(res.state.streak.current).toBe(2);
  });
});

describe('importErrorMessage', () => {
  it('各 reason にひらがなメッセージを返す', () => {
    for (const reason of ['parse', 'marker', 'shape', 'future']) {
      const msg = importErrorMessage(reason);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
    expect(importErrorMessage('unknown')).toBe('よみこめませんでした。');
  });
});

describe('makeGateProblem', () => {
  it('1桁×1桁で answer = a * b', () => {
    const p = makeGateProblem(() => 0); // a=1,b=1
    expect(p).toEqual({ a: 1, b: 1, answer: 1 });
    const q = makeGateProblem(() => 0.999); // a=9,b=9
    expect(q).toEqual({ a: 9, b: 9, answer: 81 });
  });

  it('既定の乱数でも 1..9 の範囲', () => {
    for (let i = 0; i < 50; i += 1) {
      const { a, b, answer } = makeGateProblem();
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(9);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(9);
      expect(answer).toBe(a * b);
    }
  });
});

describe('RESTORE_BACKUP_KEY', () => {
  it('退避用キーが定義されている', () => {
    expect(RESTORE_BACKUP_KEY).toBe('piano-pet-backup-before-restore');
  });
});

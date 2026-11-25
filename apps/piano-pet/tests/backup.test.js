import { describe, it, expect } from 'vitest';
import { seq } from './helpers.js';
import {
  exportState,
  backupFilename,
  parseBackup,
  importErrorMessage,
  makeGateProblem,
  RESTORE_BACKUP_KEY,
  stashBeforeOverwrite,
  readStash,
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
  it('理由ごとに別の案内を出し、未知の理由は共通の文にする', () => {
    const messages = ['parse', 'marker', 'shape', 'future', 'unknown'].map(importErrorMessage);
    expect(new Set(messages).size).toBe(5);
    expect(messages.at(-1)).toBe('よみこめませんでした。');
  });
});

describe('makeGateProblem', () => {
  it('1〜9 の2つの数を別々に引き、積を答えにする', () => {
    expect(makeGateProblem(seq(0, 0.999))).toEqual({ a: 1, b: 9, answer: 9 });
    expect(makeGateProblem(seq(0.999, 0.5))).toEqual({ a: 9, b: 5, answer: 45 });
  });
});

describe('stashBeforeOverwrite / readStash（ひとつ まえの データに もどす・#398）', () => {
  const mem = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };
  const cur = JSON.stringify({ pet: { coins: 42 } });

  it('退避したアカウント・がぞくコードでだけ読み戻せ、退避の日時も返す', () => {
    const s = mem();
    s.setItem('piano-pet', cur);
    stashBeforeOverwrite(s, 'piano-pet', { account: 'data', doc: 'X' }, 1000);
    expect(s.getItem(RESTORE_BACKUP_KEY)).toBe(cur);
    const got = readStash(s, { account: 'data', doc: 'X' });
    expect(got.state.pet.coins).toBe(42);
    expect(got.at).toBe(1000);
    expect(readStash(s, { account: 'test', doc: 'X' })).toBeNull();   // 別アカウント
    expect(readStash(s, { account: 'data', doc: 'Y' })).toBeNull();   // 取り込みで保存先が変わった
    expect(readStash(s, { account: 'data' })).toBeNull();
  });

  it('保存が無ければ退避しない・壊れた退避は null', () => {
    const s = mem();
    stashBeforeOverwrite(s, 'piano-pet', { account: 'data' });
    expect(s.getItem(RESTORE_BACKUP_KEY)).toBeNull();
    s.setItem(RESTORE_BACKUP_KEY, '{broken');
    s.setItem(`${RESTORE_BACKUP_KEY}:meta`, JSON.stringify({ account: 'data', doc: null, at: 1 }));
    expect(readStash(s, { account: 'data' })).toBeNull();
  });

  it('上書きに失敗したら、戻り値で元の退避（中身と素性）に戻せる（#428）', () => {
    const s = mem();
    s.setItem('piano-pet', cur);
    stashBeforeOverwrite(s, 'piano-pet', { account: 'data' }, 1000);
    s.setItem('piano-pet', JSON.stringify({ pet: { coins: 7 } }));
    const revert = stashBeforeOverwrite(s, 'piano-pet', { account: 'data' }, 2000);
    expect(readStash(s, { account: 'data' }).state.pet.coins).toBe(7);
    revert();
    expect(readStash(s, { account: 'data' })).toMatchObject({ at: 1000, state: { pet: { coins: 42 } } });
  });

  it('素性だけ書けなかったときは、中身と食い違わないよう元の退避のままにする（#428）', () => {
    const s = mem();
    s.setItem('piano-pet', cur);
    stashBeforeOverwrite(s, 'piano-pet', { account: 'data' }, 1000);
    s.setItem('piano-pet', JSON.stringify({ pet: { coins: 7 } }));
    const set = s.setItem;
    s.setItem = (k, v) => { if (v.includes('2000')) throw new Error('QuotaExceededError'); set(k, v); };
    stashBeforeOverwrite(s, 'piano-pet', { account: 'data' }, 2000);
    expect(readStash(s, { account: 'data' })).toMatchObject({ at: 1000, state: { pet: { coins: 42 } } });
  });

  it('素性の記録が無い旧い退避は出さない', () => {
    const s = mem();
    s.setItem(RESTORE_BACKUP_KEY, cur);
    expect(readStash(s, { account: 'data' })).toBeNull();
  });
});

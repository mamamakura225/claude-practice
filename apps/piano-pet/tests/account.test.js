import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_ACCOUNTS,
  getAccounts,
  getActiveAccountId,
  setActiveAccount,
  storageKeyFor,
  cloudDocIdFor,
  legacyCloudDocIdFor,
  getCloudDocId,
  setCloudDocId,
  generateCloudDocId,
  isValidCloudDocId,
} from '../js/account.js';

// node 環境には localStorage が無いので Map ベースの簡易モックを差し込む。
function mockLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

describe('storageKeyFor / cloudDocIdFor', () => {
  it("'data'（娘）は既存キー piano-pet / doc data を温存する", () => {
    expect(storageKeyFor('data')).toBe('piano-pet');
    expect(cloudDocIdFor('data')).toBe('data');
  });

  it('それ以外は piano-pet:<id> に名前空間化する', () => {
    expect(storageKeyFor('test')).toBe('piano-pet:test');
    expect(cloudDocIdFor('test')).toBe('test');
  });
});

describe('レジストリ（getAccounts / getActiveAccountId / setActiveAccount）', () => {
  beforeEach(() => {
    globalThis.localStorage = mockLocalStorage();
  });
  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('初期状態は既定2アカウントで有効は data（娘）', () => {
    expect(getAccounts()).toEqual(DEFAULT_ACCOUNTS);
    expect(getActiveAccountId()).toBe('data');
  });

  it('setActiveAccount で有効アカウントが切り替わり永続化される', () => {
    expect(setActiveAccount('test')).toBe(true);
    expect(getActiveAccountId()).toBe('test');
  });

  it('未知IDへの切替は拒否し有効アカウントを変えない', () => {
    expect(setActiveAccount('unknown')).toBe(false);
    expect(getActiveAccountId()).toBe('data');
  });

  it('有効IDが未知に化けていたら data に倒す', () => {
    localStorage.setItem('piano-pet:accounts', JSON.stringify({ active: 'ghost', accounts: DEFAULT_ACCOUNTS }));
    expect(getActiveAccountId()).toBe('data');
  });

  it('レジストリが壊れていても既定へフォールバックする', () => {
    localStorage.setItem('piano-pet:accounts', '{ broken');
    expect(getAccounts()).toEqual(DEFAULT_ACCOUNTS);
    expect(getActiveAccountId()).toBe('data');
  });
});

describe('クラウド保存先の推測不能化（がぞくコード・#233）', () => {
  beforeEach(() => {
    globalThis.localStorage = mockLocalStorage();
  });
  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('未移行なら旧固定IDのまま（後方互換＝移行するまで挙動は変わらない）', () => {
    expect(getCloudDocId('data')).toBeNull();
    expect(cloudDocIdFor('data')).toBe('data');
    expect(cloudDocIdFor('test')).toBe('test');
    expect(legacyCloudDocIdFor('data')).toBe('data');
  });

  it('コードを保存するとその doc ID を返す（アカウントごとに独立・#182維持）', () => {
    const code = generateCloudDocId();
    expect(setCloudDocId('data', code)).toBe(true);
    expect(getCloudDocId('data')).toBe(code);
    expect(cloudDocIdFor('data')).toBe(code);
    // 別アカウントは影響を受けない
    expect(cloudDocIdFor('test')).toBe('test');
    expect(legacyCloudDocIdFor('data')).toBe('data'); // 移行元は不変
  });

  it('generateCloudDocId は推測されにくい一意な値を返す', () => {
    const a = generateCloudDocId();
    const b = generateCloudDocId();
    expect(a).not.toBe(b);
    expect(a.startsWith('pp-')).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(isValidCloudDocId(a)).toBe(true);
  });

  it('不正な形式のコードは保存しない（Firestore doc ID 制約）', () => {
    expect(isValidCloudDocId('short')).toBe(false);
    expect(isValidCloudDocId('has space here')).toBe(false);
    expect(isValidCloudDocId('with/slash/xxxxxxx')).toBe(false);
    expect(isValidCloudDocId('')).toBe(false);
    expect(isValidCloudDocId(null)).toBe(false);
    expect(setCloudDocId('data', 'bad id')).toBe(false);
    expect(getCloudDocId('data')).toBeNull();
  });

  it('保存が壊れていても未移行として扱う（旧IDへフォールバック）', () => {
    localStorage.setItem('piano-pet:cloud-ids', '{ broken');
    expect(getCloudDocId('data')).toBeNull();
    expect(cloudDocIdFor('data')).toBe('data');
  });
});

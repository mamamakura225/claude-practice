import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_ACCOUNTS,
  getAccounts,
  getActiveAccountId,
  setActiveAccount,
  storageKeyFor,
  cloudDocIdFor,
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

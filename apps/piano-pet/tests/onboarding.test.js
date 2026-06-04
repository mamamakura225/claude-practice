import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ONBOARD_KEY,
  ONBOARD_STEPS,
  isOnboarded,
  setOnboarded,
  clearOnboarded,
  isLastStep,
  nextStepIndex,
} from '../js/onboarding.js';

// node 環境には localStorage が無いので Map ベースの簡易モックを差し込む。
function mockLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

describe('ONBOARD_STEPS', () => {
  it('紙芝居は3画面', () => {
    expect(ONBOARD_STEPS).toHaveLength(3);
  });

  it('各画面に emoji・title・body が揃っている', () => {
    for (const step of ONBOARD_STEPS) {
      expect(step.emoji).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.body).toBeTruthy();
    }
  });
});

describe('isLastStep', () => {
  it('最後の画面でだけ true', () => {
    expect(isLastStep(0)).toBe(false);
    expect(isLastStep(1)).toBe(false);
    expect(isLastStep(2)).toBe(true);
  });
});

describe('nextStepIndex', () => {
  it('次のステップへ進む', () => {
    expect(nextStepIndex(0)).toBe(1);
    expect(nextStepIndex(1)).toBe(2);
  });

  it('最後の画面では範囲内に留まる', () => {
    expect(nextStepIndex(2)).toBe(2);
  });
});

describe('isOnboarded / setOnboarded', () => {
  beforeEach(() => {
    globalThis.localStorage = mockLocalStorage();
  });
  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('初期状態は未完了', () => {
    expect(isOnboarded()).toBe(false);
  });

  it('setOnboarded でフラグが立つ', () => {
    setOnboarded();
    expect(localStorage.getItem(ONBOARD_KEY)).toBe('1');
    expect(isOnboarded()).toBe(true);
  });

  it('clearOnboarded でまた未完了に戻る', () => {
    setOnboarded();
    clearOnboarded();
    expect(isOnboarded()).toBe(false);
  });

  it('localStorage 不在でも例外を投げず「完了扱い」で案内を抑止する', () => {
    delete globalThis.localStorage;
    expect(() => isOnboarded()).not.toThrow();
    expect(isOnboarded()).toBe(true);
  });
});

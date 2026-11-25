import { describe, it, expect } from 'vitest';
import { ONBOARD_KEY, isOnboarded, setOnboarded } from '../js/onboarding.js';
import { isLastStep, nextStepIndex } from '../js/onboarding-ui.js';
import { useMockLocalStorage } from './helpers.js';

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
  useMockLocalStorage();

  it('初期状態は未完了', () => {
    expect(isOnboarded()).toBe(false);
  });

  it('setOnboarded でフラグが立つ', () => {
    setOnboarded();
    expect(localStorage.getItem(ONBOARD_KEY)).toBe('1');
    expect(isOnboarded()).toBe(true);
  });

  it('localStorage 不在でも例外を投げず「完了扱い」で案内を抑止する', () => {
    delete globalThis.localStorage;
    expect(() => isOnboarded()).not.toThrow();
    expect(isOnboarded()).toBe(true);
  });
});

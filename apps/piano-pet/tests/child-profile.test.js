import { describe, it, expect } from 'vitest';
import {
  CHILD_AVATARS,
  DEFAULT_CHILD_AVATAR,
  normalizeChildAvatar,
  avatarEmoji,
  normalizeChildName,
} from '../js/child-profile.js';

describe('normalizeChildAvatar', () => {
  it('既知IDはそのまま返す', () => {
    expect(normalizeChildAvatar('rabbit')).toBe('rabbit');
  });

  it('未知・未設定は既定IDにフォールバックする', () => {
    expect(normalizeChildAvatar('nope')).toBe(DEFAULT_CHILD_AVATAR);
    expect(normalizeChildAvatar(undefined)).toBe(DEFAULT_CHILD_AVATAR);
    expect(normalizeChildAvatar('')).toBe(DEFAULT_CHILD_AVATAR);
  });
});

describe('avatarEmoji', () => {
  it('IDに対応する絵文字を返す', () => {
    const rabbit = CHILD_AVATARS.find((a) => a.id === 'rabbit');
    expect(avatarEmoji('rabbit')).toBe(rabbit.emoji);
  });

  it('未知IDは既定の絵文字を返す', () => {
    const def = CHILD_AVATARS.find((a) => a.id === DEFAULT_CHILD_AVATAR);
    expect(avatarEmoji('nope')).toBe(def.emoji);
    expect(avatarEmoji(undefined)).toBe(def.emoji);
  });
});

describe('normalizeChildName', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeChildName('  みき ')).toBe('みき');
  });

  it('12文字を超える分は丸める', () => {
    expect(normalizeChildName('あ'.repeat(20))).toBe('あ'.repeat(12));
  });

  it('未設定は空文字', () => {
    expect(normalizeChildName(undefined)).toBe('');
    expect(normalizeChildName(null)).toBe('');
  });
});

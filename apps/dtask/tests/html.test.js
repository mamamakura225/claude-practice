import { describe, it, expect } from 'vitest';
import { escHtml } from '../utils/html.js';

describe('escHtml', () => {
  it('< と > をエスケープする', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('& をエスケープする', () => {
    expect(escHtml('A & B')).toBe('A &amp; B');
  });

  it('" をエスケープする', () => {
    expect(escHtml('"text"')).toBe('&quot;text&quot;');
  });

  it('エスケープ不要な文字列はそのまま返す', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });

  it('数値も文字列として処理する', () => {
    expect(escHtml(42)).toBe('42');
  });
});

import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../js/html.js';

describe('escapeHtml（#274 / #312）', () => {
  it('HTML 特殊5文字をすべて実体参照へ置換する', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('属性を閉じてイベントハンドラを注入する文字列を無害化する', () => {
    const payload = 'ribbon" onmouseover="alert(1)';
    expect(escapeHtml(payload)).toBe('ribbon&quot; onmouseover=&quot;alert(1)');
  });

  it('非文字列も String 化してから処理する', () => {
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(42)).toBe('42');
  });

  it('特殊文字を含まない文字列はそのまま返す', () => {
    expect(escapeHtml('きらきらぼし')).toBe('きらきらぼし');
  });
});

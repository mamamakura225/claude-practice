import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { NAV_VIEWS, hashFromView, createRouter } from '../js/router.js';

describe('createRouter', () => {
  const viewOf = (hash) => {
    const router = createRouter({ onChange: () => {} });
    router.syncFromHash(hash);
    return router.current;
  };

  it('ナビのビューは hash と往復し、未知・空の hash はホームに丸める', () => {
    for (const view of NAV_VIEWS) expect(viewOf(hashFromView(view))).toBe(view);
    for (const hash of ['#/bogus', '#/', '', undefined]) expect(viewOf(hash)).toBe('home');
  });

  it('manifest のショートカット（#235）の飛び先が、知っているビューになっている', () => {
    const { shortcuts } = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const { url } of shortcuts) {
      const hash = url.slice(url.indexOf('#'));
      expect(hashFromView(viewOf(hash)), url).toBe(hash);
    }
  });

  it('同じビューへの go では onChange を呼ばない（描画し直しでフォームが消えない）', () => {
    const onChange = vi.fn();
    const router = createRouter({ onChange });
    router.go('shop');
    router.go('shop');
    router.syncFromHash('#/shop');
    expect(onChange.mock.calls).toEqual([['shop']]);
    expect(router.current).toBe('shop');
  });
});

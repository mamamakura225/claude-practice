// ===== ナビゲーション（4画面のハッシュルーター） =====

export const VIEWS = ['home', 'record', 'history', 'shop', 'badges'];
export const DEFAULT_VIEW = 'home';

// ボトムナビに出すビュー（record はホームのボタンから遷移するので含めない）
export const NAV_VIEWS = ['home', 'history', 'shop', 'badges'];

// location.hash → ビュー名。未知の値は DEFAULT_VIEW に丸める。
export function viewFromHash(hash) {
  const name = String(hash || '').replace(/^#\/?/, '');
  return VIEWS.includes(name) ? name : DEFAULT_VIEW;
}

export function hashFromView(view) {
  return `#/${view}`;
}

// DOM を持たない純粋ロジック。テスト可能。
// onChange(view) は実際の表示切り替えに使う。
export function createRouter({ onChange } = {}) {
  let current = null;

  function go(view) {
    const next = VIEWS.includes(view) ? view : DEFAULT_VIEW;
    if (next === current) return next;
    current = next;
    if (typeof onChange === 'function') onChange(next);
    return next;
  }

  return {
    get current() {
      return current;
    },
    go,
    syncFromHash(hash) {
      return go(viewFromHash(hash));
    },
  };
}

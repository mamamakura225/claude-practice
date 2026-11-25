// ===== ナビゲーション（ハッシュルーター） =====

const VIEWS = ['home', 'record', 'history', 'shop', 'badges', 'stamp'];
const DEFAULT_VIEW = 'home';

// ボトムナビに出すビュー（record はホームのボタンから遷移するので含めない）
export const NAV_VIEWS = ['home', 'history', 'shop', 'badges', 'stamp'];

// location.hash → ビュー名。未知の値は DEFAULT_VIEW に丸める。
function viewFromHash(hash) {
  const name = String(hash || '').replace(/^#\/?/, '');
  return VIEWS.includes(name) ? name : DEFAULT_VIEW;
}

export function hashFromView(view) {
  return `#/${view}`;
}

// onChange(view) は実際の表示切り替えに使う。
export function createRouter({ onChange }) {
  let current = null;

  function go(view) {
    if (view === current) return;
    current = view;
    onChange(view);
  }

  return {
    get current() {
      return current;
    },
    go,
    syncFromHash(hash) {
      go(viewFromHash(hash));
    },
  };
}

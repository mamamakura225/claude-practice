import { beforeEach, afterEach } from 'vitest';

/** node には localStorage が無いので、テストごとにまっさらな簡易版を差し込む。 */
export function useMockLocalStorage() {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });
  afterEach(() => { delete globalThis.localStorage; });
}

/** 指定した値を順に返す rng。使い切ったら最後の値を返し続ける。 */
export const seq = (...values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

/** js/ から見た相対パス（img/… や ./video/…）の実ファイル URL。 */
export const appFile = (rel) => new URL(rel, new URL('../index.html', import.meta.url));

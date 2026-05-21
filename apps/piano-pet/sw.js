// ===== Service Worker（ネットワーク優先＋オフラインフォールバック） =====
const CACHE = 'piano-pet-v4';

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css?v=1',
  './css/cat.css?v=1',
  './js/app.js?v=1',
  './js/router.js',
  './js/storage.js',
  './js/game.js',
  './js/cat.js',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 同一オリジン: network-first（オンラインは常に最新、失敗時のみキャッシュ）。
// 取得成功時にキャッシュを更新するので、オフラインでも直近の内容で動く。
// 外部オリジン（フォント等）: cache-first。
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // cache:'reload' でブラウザのHTTPキャッシュをバイパスし常に最新を取得。
    // （ESモジュール import にはバージョン文字列が付かず古い版が残るため）
    event.respondWith(
      fetch(request, { cache: 'reload' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            if (request.mode === 'navigate') return caches.match('./index.html');
            return Response.error();
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

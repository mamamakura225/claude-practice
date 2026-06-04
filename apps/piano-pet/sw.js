// ===== Service Worker（ネットワーク優先＋オフラインフォールバック） =====
const CACHE = 'piano-pet-ee56dff3';

const APP_SHELL = [
  './',
  './index.html',
  './css/cat.css?v=ee56dff3',
  './css/style.css?v=ee56dff3',
  './js/analytics.js',
  './js/app.js?v=ee56dff3',
  './js/backup.js',
  './js/badges.js',
  './js/cat.js',
  './js/cloud.js',
  './js/feed.js',
  './js/firebase-config.js',
  './js/game.js',
  './js/history.js',
  './js/monitoring-config.js',
  './js/onboarding.js',
  './js/record-form.js',
  './js/router.js',
  './js/sentry.js',
  './js/shop.js',
  './js/song-color.js',
  './js/sound.js',
  './js/storage.js',
  './manifest.json',
  './icons/icon.svg',
  './sounds/hiss1.mp3',
  './sounds/meow1.mp3',
  './sounds/meow2.mp3',
  './sounds/meow3.mp3',
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
